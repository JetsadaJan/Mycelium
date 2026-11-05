use crate::models::{
    BacklinkRef, EpistemicStatus, GraphEdge, GraphNode, NoteDocument, UnlinkedMention,
    VaultSnapshot, VerificationAuditEntry,
};
use crate::parser::{
    find_unlinked_position, link_term_in_markdown, normalize_id, parse_frontmatter, parse_note,
    strip_obsidian_comments, verify_entire_markdown, verify_segment_in_markdown,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const IGNORED_FILES: &[&str] = &["AGENTS.md", "CLAUDE.md", "README.md", "PROJECT_MAP.md"];

pub struct VaultEngine {
    pub root: PathBuf,
}

impl VaultEngine {
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        let root_path = root.as_ref().to_path_buf();
        Self { root: root_path }
    }

    /// Resolve a media asset path relative to the Colony root (Obsidian shortest-path compatible)
    pub fn resolve_asset_path(&self, raw_path: &str) -> Option<PathBuf> {
        let cleaned = raw_path
            .trim()
            .trim_start_matches('/')
            .replace("..", "");
        if cleaned.is_empty() {
            return None;
        }

        // 1. Direct relative path inside Colony
        let direct = self.root.join(&cleaned);
        if direct.is_file() {
            return Some(direct);
        }

        // 1.5 Check .obsidian/app.json for custom attachmentFolderPath
        let app_json_path = self.root.join(".obsidian").join("app.json");
        if let Ok(app_json_raw) = fs::read_to_string(&app_json_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&app_json_raw) {
                if let Some(att_folder) = parsed.get("attachmentFolderPath").and_then(|v| v.as_str()) {
                    let clean_att = att_folder.trim().trim_start_matches("./").trim_start_matches('/');
                    if !clean_att.is_empty() {
                        let candidate = self.root.join(clean_att).join(&cleaned);
                        if candidate.is_file() {
                            return Some(candidate);
                        }
                    }
                }
            }
        }

        // 2. Common Obsidian attachment folders: assets/ or attachments/
        for folder in &["assets", "attachments", "media", "images"] {
            let candidate = self.root.join(folder).join(&cleaned);
            if candidate.is_file() {
                return Some(candidate);
            }
        }

        // 3. Obsidian shortest-path match by filename anywhere in Colony
        let target_filename = Path::new(&cleaned)
            .file_name()
            .and_then(|s| s.to_str())?
            .to_lowercase();

        for entry in WalkDir::new(&self.root)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                if let Some(fname) = entry.file_name().to_str() {
                    if fname.to_lowercase() == target_filename {
                        return Some(entry.path().to_path_buf());
                    }
                }
            }
        }

        None
    }

    pub fn ensure_companion_files(&self) -> Result<(), String> {
        let mycelium_dir = self.root.join(".mycelium");
        fs::create_dir_all(&mycelium_dir).map_err(|e| e.to_string())?;

        let obsidian_snippets = self.root.join(".obsidian").join("snippets");
        fs::create_dir_all(&obsidian_snippets).map_err(|e| e.to_string())?;

        let css_path = obsidian_snippets.join("mycelium-epistemic.css");
        if !css_path.exists() {
            let css = r#"/* Mycelium Epistemic AI Styling for Obsidian Compatibility */
.callout[data-callout="ai"],
.callout[data-callout="ai-draft"],
.callout[data-callout="ai-unverified"] {
  --callout-color: 245, 158, 11;
  --callout-icon: lucide-sparkles;
  border-left: 3px solid #f59e0b;
  background-color: rgba(245, 158, 11, 0.10);
}

.markdown-rendered mark,
.cm-s-obsidian span.cm-highlight {
  background-color: rgba(245, 158, 11, 0.22);
  color: inherit;
  border-bottom: 1px dashed #f59e0b;
  padding: 0 3px;
  border-radius: 3px;
}
"#;
            fs::write(&css_path, css).map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    pub fn scan_vault(&self) -> Result<VaultSnapshot, String> {
        self.ensure_companion_files()?;

        let mut notes: Vec<NoteDocument> = Vec::new();
        for entry in WalkDir::new(&self.root)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                if e.path() == self.root {
                    return true;
                }
                !name.starts_with('.')
                    && name != "node_modules"
                    && name != "target"
                    && name != "dist"
            })
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let file_name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default();
            if IGNORED_FILES.contains(&file_name) {
                continue;
            }

            let rel_path = path
                .strip_prefix(&self.root)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");

            let raw_md = fs::read_to_string(path).map_err(|e| e.to_string())?;
            let updated_at = "2026-11-05".to_string();
            let doc = parse_note(&rel_path, &raw_md, &updated_at);
            notes.push(doc);
        }

        notes.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));

        // Map aliases, titles, and subfolder relative paths to canonical note ID
        let mut term_to_id: HashMap<String, (String, String)> = HashMap::new();
        for note in &notes {
            term_to_id.insert(
                normalize_id(&note.title),
                (note.id.clone(), note.title.clone()),
            );
            term_to_id.insert(note.id.clone(), (note.id.clone(), note.title.clone()));
            let rel_slug = normalize_id(&note.rel_path);
            if !rel_slug.is_empty() {
                term_to_id.insert(rel_slug, (note.id.clone(), note.title.clone()));
            }
            for alias in &note.aliases {
                let slug = normalize_id(alias);
                if !slug.is_empty() {
                    term_to_id.insert(slug, (note.id.clone(), note.title.clone()));
                }
            }
        }

        let mut backlinks: HashMap<String, Vec<BacklinkRef>> = HashMap::new();
        let mut graph_edges: Vec<GraphEdge> = Vec::new();
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut out_degree: HashMap<String, usize> = HashMap::new();
        let mut stub_nodes: HashMap<String, String> = HashMap::new();

        for note in &notes {
            backlinks.entry(note.id.clone()).or_default();
            let mut seen_targets: HashSet<String> = HashSet::new();

            for link in &note.outgoing_links {
                let stem_fallback = link
                    .target
                    .rsplit('/')
                    .next()
                    .map(normalize_id)
                    .unwrap_or_else(|| link.target_slug.clone());
                let resolved_id = term_to_id
                    .get(&link.target_slug)
                    .or_else(|| term_to_id.get(&stem_fallback))
                    .map(|(id, _)| id.clone())
                    .unwrap_or_else(|| {
                        stub_nodes
                            .entry(link.target_slug.clone())
                            .or_insert_with(|| link.target.clone());
                        link.target_slug.clone()
                    });

                if resolved_id == note.id {
                    continue;
                }

                backlinks.entry(resolved_id.clone()).or_default().push(BacklinkRef {
                    source_id: note.id.clone(),
                    source_title: note.title.clone(),
                    source_path: note.rel_path.clone(),
                    line: link.line,
                    context: link.context.clone(),
                    display_text: link.display_text.clone(),
                });

                if seen_targets.insert(resolved_id.clone()) {
                    *out_degree.entry(note.id.clone()).or_insert(0) += 1;
                    *in_degree.entry(resolved_id.clone()).or_insert(0) += 1;
                    graph_edges.push(GraphEdge {
                        source: note.id.clone(),
                        target: resolved_id,
                        label: if link.display_text != link.target {
                            Some(link.display_text.clone())
                        } else {
                            None
                        },
                    });
                }
            }
        }

        // Compute Unlinked Mentions across the Vault
        let mut unlinked_mentions: HashMap<String, Vec<UnlinkedMention>> = HashMap::new();
        for target_note in &notes {
            let mut terms = vec![target_note.title.clone()];
            for a in &target_note.aliases {
                if a.chars().count() >= 2 && !terms.contains(a) {
                    terms.push(a.clone());
                }
            }

            let mut list = Vec::new();
            for source_note in &notes {
                if source_note.id == target_note.id {
                    continue;
                }
                let already_links = source_note.outgoing_links.iter().any(|l| {
                    term_to_id
                        .get(&l.target_slug)
                        .map(|(id, _)| id == &target_note.id)
                        .unwrap_or(false)
                });
                if already_links {
                    // Even if linked elsewhere in the note, check lines that have unlinked occurrences
                }

                let (_, _, _, _, body_slice) = parse_frontmatter(&source_note.raw_markdown);
                let comment_free_body = strip_obsidian_comments(body_slice);
                for (line_idx, line) in comment_free_body.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with('#') {
                        continue;
                    }
                    for term in &terms {
                        if term.chars().count() < 2 {
                            continue;
                        }
                        if find_unlinked_position(line, term).is_some() {
                            list.push(UnlinkedMention {
                                source_id: source_note.id.clone(),
                                source_title: source_note.title.clone(),
                                target_id: target_note.id.clone(),
                                target_title: target_note.title.clone(),
                                matched_term: term.clone(),
                                line: line_idx + 1,
                                context: trimmed.trim_start_matches('>').trim().to_string(),
                            });
                            break;
                        }
                    }
                }
            }
            unlinked_mentions.insert(target_note.id.clone(), list);
        }

        let mut graph_nodes: Vec<GraphNode> = notes
            .iter()
            .map(|n| GraphNode {
                id: n.id.clone(),
                title: n.title.clone(),
                folder: n.folder.clone(),
                tags: n.tags.clone(),
                epistemic_status: n.epistemic_status.clone(),
                ai_segment_count: n.ai_segments.len(),
                is_stub: false,
                in_degree: *in_degree.get(&n.id).unwrap_or(&0),
                out_degree: *out_degree.get(&n.id).unwrap_or(&0),
            })
            .collect();

        for (stub_id, stub_title) in stub_nodes {
            graph_nodes.push(GraphNode {
                id: stub_id.clone(),
                title: stub_title,
                folder: String::new(),
                tags: vec!["stub".to_string()],
                epistemic_status: EpistemicStatus::Verified,
                ai_segment_count: 0,
                is_stub: true,
                in_degree: *in_degree.get(&stub_id).unwrap_or(&0),
                out_degree: 0,
            });
        }

        let verification_log = self.read_verification_log();

        let snapshot = VaultSnapshot {
            vault_path: self.root.to_string_lossy().to_string(),
            notes,
            backlinks,
            unlinked_mentions,
            graph_nodes,
            graph_edges,
            verification_log,
        };

        self.write_index_file(&snapshot)?;
        Ok(snapshot)
    }

    pub fn save_note(&self, rel_path: &str, raw_markdown: &str) -> Result<VaultSnapshot, String> {
        let safe_rel = rel_path.trim_start_matches('/').replace("..", "");
        let full_path = self.root.join(&safe_rel);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&full_path, raw_markdown).map_err(|e| e.to_string())?;
        self.scan_vault()
    }

    pub fn verify_segment(
        &self,
        note_id: &str,
        segment_id: &str,
        verified_date: &str,
    ) -> Result<VaultSnapshot, String> {
        let snap = self.scan_vault()?;
        let note = snap
            .notes
            .iter()
            .find(|n| n.id == note_id)
            .ok_or_else(|| format!("Note not found: {}", note_id))?;

        let updated = verify_segment_in_markdown(&note.raw_markdown, segment_id, verified_date);
        let full_path = self.root.join(&note.rel_path);
        fs::write(&full_path, updated).map_err(|e| e.to_string())?;

        self.append_verification_log(VerificationAuditEntry {
            timestamp: verified_date.to_string(),
            note_id: note_id.to_string(),
            action: "verify_segment".to_string(),
            detail: format!("Verified AI segment {} in {}", segment_id, note.title),
        });

        self.scan_vault()
    }

    pub fn verify_entire_note(
        &self,
        note_id: &str,
        verified_date: &str,
    ) -> Result<VaultSnapshot, String> {
        let snap = self.scan_vault()?;
        let note = snap
            .notes
            .iter()
            .find(|n| n.id == note_id)
            .ok_or_else(|| format!("Note not found: {}", note_id))?;

        let updated = verify_entire_markdown(&note.raw_markdown, verified_date);
        let full_path = self.root.join(&note.rel_path);
        fs::write(&full_path, updated).map_err(|e| e.to_string())?;

        self.append_verification_log(VerificationAuditEntry {
            timestamp: verified_date.to_string(),
            note_id: note_id.to_string(),
            action: "verify_note".to_string(),
            detail: format!("Verified all AI content in {}", note.title),
        });

        self.scan_vault()
    }

    pub fn link_term(
        &self,
        note_id: &str,
        term: &str,
        target_title: &str,
    ) -> Result<VaultSnapshot, String> {
        let snap = self.scan_vault()?;
        let note = snap
            .notes
            .iter()
            .find(|n| n.id == note_id)
            .ok_or_else(|| format!("Note not found: {}", note_id))?;

        let updated = link_term_in_markdown(&note.raw_markdown, term, target_title);
        let full_path = self.root.join(&note.rel_path);
        fs::write(&full_path, updated).map_err(|e| e.to_string())?;
        self.scan_vault()
    }

    /// Rename a .md Node and automatically refactor all [[Old Title]] Hyphae across the Colony
    pub fn rename_note_and_refactor(
        &self,
        old_rel_path: &str,
        old_title: &str,
        new_rel_path: &str,
        new_title: &str,
        new_raw_markdown: &str,
    ) -> Result<VaultSnapshot, String> {
        let old_full = self.root.join(old_rel_path);
        let new_full = self.root.join(new_rel_path);
        if let Some(parent) = new_full.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&new_full, new_raw_markdown).map_err(|e| e.to_string())?;
        if old_full != new_full && old_full.exists() {
            let _ = fs::remove_file(&old_full);
        }

        let old_clean = old_title.trim();
        let new_clean = new_title.trim();
        if !old_clean.is_empty() && !new_clean.is_empty() && old_clean != new_clean {
            let snap = self.scan_vault()?;
            for note in snap.notes {
                if note.rel_path == new_rel_path {
                    continue;
                }
                let mut updated = note.raw_markdown.clone();
                // Replace [[Old Title]], [[Old Title|...]], [[Old Title#...]]
                for prefix in &["[[", "![["] {
                    let exact = format!("{}{}]]", prefix, old_clean);
                    let exact_new = format!("{}{}]]", prefix, new_clean);
                    updated = updated.replace(&exact, &exact_new);

                    let pipe = format!("{}{}|", prefix, old_clean);
                    let pipe_new = format!("{}{}|", prefix, new_clean);
                    updated = updated.replace(&pipe, &pipe_new);

                    let hash = format!("{}{}#", prefix, old_clean);
                    let hash_new = format!("{}{}#", prefix, new_clean);
                    updated = updated.replace(&hash, &hash_new);
                }
                if updated != note.raw_markdown {
                    let p = self.root.join(&note.rel_path);
                    let _ = fs::write(p, updated);
                }
            }
        }

        self.scan_vault()
    }

    pub fn delete_note(&self, rel_path: &str) -> Result<VaultSnapshot, String> {
        let full = self.root.join(rel_path);
        if full.is_file() {
            fs::remove_file(&full).map_err(|e| e.to_string())?;
        }
        self.scan_vault()
    }

    fn read_verification_log(&self) -> Vec<VerificationAuditEntry> {
        let log_path = self.root.join(".mycelium").join("verification-log.json");
        if let Ok(content) = fs::read_to_string(log_path) {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    fn append_verification_log(&self, entry: VerificationAuditEntry) {
        let mut log = self.read_verification_log();
        log.insert(0, entry);
        let log_path = self.root.join(".mycelium").join("verification-log.json");
        if let Ok(json) = serde_json::to_string_pretty(&log) {
            let _ = fs::write(log_path, json);
        }
    }

    fn write_index_file(&self, snapshot: &VaultSnapshot) -> Result<(), String> {
        let index_path = self.root.join(".mycelium").join("index.json");
        let summary = serde_json::json!({
            "vault_path": snapshot.vault_path,
            "note_count": snapshot.notes.len(),
            "graph_nodes": snapshot.graph_nodes,
            "graph_edges": snapshot.graph_edges,
            "verification_log": snapshot.verification_log,
        });
        let json = serde_json::to_string_pretty(&summary).map_err(|e| e.to_string())?;
        fs::write(index_path, json).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_vault_indexing_backlinks_and_verification() {
        let tmp_dir = env::temp_dir().join("mycelium_vault_test_1");
        let _ = fs::remove_dir_all(&tmp_dir);
        fs::create_dir_all(&tmp_dir).unwrap();

        fs::write(
            tmp_dir.join("Mycelium.md"),
            r#"---
title: Mycelium
aliases: [ไมซีเลียม]
tags: [biology]
ai_status: partial
---
Mycelium is the vegetative part of a [[Fungus]].
> [!ai] AI Draft
> It forms symbiotic [[Mycorrhiza]] networks.
"#,
        )
        .unwrap();

        fs::write(
            tmp_dir.join("Fungus.md"),
            r#"---
title: Fungus
tags: [biology]
ai_status: verified
---
A fungus grows via Mycelium threads in soil.
"#,
        )
        .unwrap();

        let engine = VaultEngine::new(&tmp_dir);
        let snap = engine.scan_vault().unwrap();

        assert_eq!(snap.notes.len(), 2);
        // Fungus should have 1 incoming backlink from Mycelium
        let fungus_backlinks = snap.backlinks.get("fungus").unwrap();
        assert_eq!(fungus_backlinks.len(), 1);
        assert_eq!(fungus_backlinks[0].source_id, "mycelium");

        // Mycelium should have 1 unlinked mention from Fungus ("Mycelium" mentioned without [[...]])
        let myc_mentions = snap.unlinked_mentions.get("mycelium").unwrap();
        assert_eq!(myc_mentions.len(), 1);
        assert_eq!(myc_mentions[0].source_id, "fungus");

        // Stub node "mycorrhiza" should exist in graph_nodes
        assert!(snap.graph_nodes.iter().any(|n| n.id == "mycorrhiza" && n.is_stub));

        // Verify segment in Mycelium.md
        let snap_after = engine
            .verify_segment("mycelium", "ai-seg-1", "2026-11-05")
            .unwrap();
        let myc_note = snap_after.notes.iter().find(|n| n.id == "mycelium").unwrap();
        assert_eq!(myc_note.epistemic_status, EpistemicStatus::Verified);
        assert_eq!(myc_note.ai_segments.len(), 0);

        // Companion files created (.obsidian CSS snippet ensured without auto-cluttering root AGENTS.md)
        assert!(tmp_dir.join(".mycelium/index.json").exists());
        assert!(tmp_dir.join(".obsidian/snippets/mycelium-epistemic.css").exists());
        assert!(!tmp_dir.join("AGENTS.md").exists());

        let _ = fs::remove_dir_all(&tmp_dir);
    }
}
