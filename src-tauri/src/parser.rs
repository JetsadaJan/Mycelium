use crate::models::{AiSegment, EpistemicStatus, HeadingRef, HyphaLinkRef, NoteDocument, WikiLinkRef};
use regex::Regex;
use std::collections::HashMap;

pub fn normalize_id(input: &str) -> String {
    let trimmed = input
        .trim()
        .trim_end_matches(".md")
        .split('#')
        .next()
        .unwrap_or("")
        .trim();
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in trimmed.chars() {
        if ch.is_whitespace() || ch == '_' || ch == '/' {
            if !prev_dash && !out.is_empty() {
                out.push('-');
                prev_dash = true;
            }
        } else {
            for lower in ch.to_lowercase() {
                out.push(lower);
            }
            prev_dash = false;
        }
    }
    out.trim_matches('-').to_string()
}

pub fn strip_delimited_comments(markdown: &str) -> String {
    if !markdown.contains("%%") {
        return markdown.to_string();
    }
    let re = Regex::new(r"(?s)%%.*?%%").unwrap();
    re.replace_all(markdown, "").to_string()
}

/// Backward compatibility alias
#[inline]
pub fn strip_obsidian_comments(markdown: &str) -> String {
    strip_delimited_comments(markdown)
}

pub fn normalize_formatted_links(markdown: &str) -> String {
    let re = Regex::new(r"(!?)\[\[([^\[\]\n]+)\]\]").unwrap();
    re.replace_all(markdown, |caps: &regex::Captures| {
        let bang = &caps[1];
        if bang == "!" {
            return caps[0].to_string();
        }
        let trimmed = caps[2].trim();
        if trimmed.starts_with("**") && trimmed.ends_with("**") && trimmed.len() > 4 {
            let inner = trimmed[2..trimmed.len() - 2].trim();
            return format!("**[[{}]]**", inner);
        }
        if trimmed.starts_with('*') && trimmed.ends_with('*') && trimmed.len() > 2 {
            let inner = trimmed[1..trimmed.len() - 1].trim();
            return format!("*[[{}]]*", inner);
        }
        if let Some((raw_target, raw_alias)) = trimmed.split_once('|') {
            let rt = raw_target.trim();
            let ra = raw_alias.trim();
            let is_bold = (rt.starts_with("**") && rt.ends_with("**"))
                || (ra.starts_with("**") && ra.ends_with("**"));
            let is_italic = !is_bold
                && ((rt.starts_with('*') && rt.ends_with('*'))
                    || (ra.starts_with('*') && ra.ends_with('*')));
            let clean_target = rt.trim_matches('*').trim();
            let clean_alias = ra.trim_matches('*').trim();
            let core = if clean_alias.is_empty() {
                format!("[[{}]]", clean_target)
            } else {
                format!("[[{}|{}]]", clean_target, clean_alias)
            };
            if is_bold {
                return format!("**{}**", core);
            }
            if is_italic {
                return format!("*{}*", core);
            }
        }
        caps[0].to_string()
    })
    .to_string()
}

/// Backward compatibility alias
#[inline]
pub fn normalize_obsidian_formatted_links(markdown: &str) -> String {
    normalize_formatted_links(markdown)
}

pub fn parse_frontmatter(raw: &str) -> (HashMap<String, String>, Vec<String>, Vec<String>, Vec<String>, &str) {
    let mut map = HashMap::new();
    let mut aliases = Vec::new();
    let mut tags = Vec::new();
    let mut sources = Vec::new();

    let normalized = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    if !normalized.starts_with("---\n") && !normalized.starts_with("---\r\n") {
        return (map, aliases, tags, sources, normalized);
    }

    let after_open = if normalized.starts_with("---\r\n") {
        &normalized[5..]
    } else {
        &normalized[4..]
    };

    let close_pos = after_open
        .find("\n---\n")
        .map(|idx| (idx, idx + 5))
        .or_else(|| after_open.find("\n---\r\n").map(|idx| (idx, idx + 6)))
        .or_else(|| {
            if after_open.ends_with("\n---") {
                Some((after_open.len() - 4, after_open.len()))
            } else {
                None
            }
        });

    let Some((yaml_end, body_start)) = close_pos else {
        return (map, aliases, tags, sources, normalized);
    };

    let yaml_str = &after_open[..yaml_end];
    let body = &after_open[body_start..];

    let mut current_list_key: Option<String> = None;

    for line in yaml_str.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(item) = trimmed.strip_prefix("- ") {
            if let Some(ref key) = current_list_key {
                let clean = item.trim().trim_matches('"').trim_matches('\'').to_string();
                if !clean.is_empty() {
                    match key.as_str() {
                        "aliases" | "alias" => aliases.push(clean),
                        "tags" | "tag" => tags.push(clean.trim_start_matches('#').to_string()),
                        "sources" | "source" => sources.push(clean),
                        _ => {}
                    }
                }
            }
            continue;
        }

        if let Some((k, v)) = trimmed.split_once(':') {
            let key = k.trim().to_lowercase();
            let val = v.trim();
            if val.is_empty() {
                current_list_key = Some(key);
                continue;
            }
            current_list_key = None;

            if val.starts_with('[') && val.ends_with(']') {
                let inner = &val[1..val.len() - 1];
                let items: Vec<String> = inner
                    .split(',')
                    .map(|s| s.trim().trim_matches('"').trim_matches('\'').to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                match key.as_str() {
                    "aliases" | "alias" => aliases.extend(items),
                    "tags" | "tag" => {
                        tags.extend(items.into_iter().map(|t| t.trim_start_matches('#').to_string()))
                    }
                    "sources" | "source" => sources.extend(items),
                    _ => {
                        map.insert(key, val.to_string());
                    }
                }
            } else {
                let clean_val = val.trim_matches('"').trim_matches('\'').to_string();
                match key.as_str() {
                    "aliases" | "alias" => aliases.push(clean_val.clone()),
                    "tags" | "tag" => {
                        for part in clean_val.split(|c: char| c == ',' || c.is_whitespace()) {
                            let clean_tag = part.trim().trim_start_matches('#');
                            if !clean_tag.is_empty() {
                                tags.push(clean_tag.to_string());
                            }
                        }
                    }
                    "sources" | "source" => sources.push(clean_val.clone()),
                    _ => {}
                }
                map.insert(key, clean_val);
            }
        }
    }

    (map, aliases, tags, sources, body)
}

pub fn parse_note(rel_path: &str, raw_markdown: &str, updated_at: &str) -> NoteDocument {
    let file_stem = std::path::Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();

    let folder = std::path::Path::new(rel_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();

    let (frontmatter, aliases, mut tags, sources, body_slice) = parse_frontmatter(raw_markdown);
    let title = frontmatter
        .get("title")
        .cloned()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| file_stem.clone());

    let id = normalize_id(&file_stem);
    let body = body_slice.to_string();
    let comment_free_body = strip_delimited_comments(&body);

    // Extract inline #tags from comment-free body
    let tag_re = Regex::new(r"(?:^|\s)#([a-zA-Z0-9_\-\u0E00-\u0E7F/]+)").unwrap();
    for line in comment_free_body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') && trimmed.chars().nth(1) == Some(' ') {
            continue;
        }
        for cap in tag_re.captures_iter(line) {
            let t = cap[1].to_string();
            if !tags.contains(&t) {
                tags.push(t);
            }
        }
    }

    let headings = parse_headings(&comment_free_body);
    let outgoing_links = parse_hypha_links(&comment_free_body);
    let ai_segments = parse_ai_segments(&body);

    let fm_status = frontmatter
        .get("ai_status")
        .or_else(|| frontmatter.get("status"))
        .map(|s| s.to_lowercase());

    let epistemic_status = match fm_status.as_deref() {
        Some("unverified") | Some("ai-draft") | Some("ai") => EpistemicStatus::Unverified,
        Some("partial") | Some("partially-verified") => {
            if ai_segments.is_empty() {
                EpistemicStatus::Verified
            } else {
                EpistemicStatus::Partial
            }
        }
        Some("verified") | Some("human") => {
            if ai_segments.is_empty() {
                EpistemicStatus::Verified
            } else {
                EpistemicStatus::Partial
            }
        }
        _ => {
            if !ai_segments.is_empty() || tags.iter().any(|t| t == "ai-unverified" || t == "ai-draft") {
                EpistemicStatus::Partial
            } else {
                EpistemicStatus::Verified
            }
        }
    };

    let ai_source = frontmatter.get("ai_source").cloned();
    let verified_at = frontmatter.get("verified_at").cloned();
    let word_count = body.split_whitespace().count();

    NoteDocument {
        id,
        title,
        rel_path: rel_path.to_string(),
        folder,
        aliases,
        tags,
        frontmatter,
        body,
        raw_markdown: raw_markdown.to_string(),
        epistemic_status,
        ai_source,
        verified_at,
        sources,
        ai_segments,
        outgoing_links,
        headings,
        word_count,
        updated_at: updated_at.to_string(),
    }
}

pub fn parse_headings(body: &str) -> Vec<HeadingRef> {
    let mut out = Vec::new();
    for (idx, line) in body.lines().enumerate() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') {
            let level = trimmed.chars().take_while(|&c| c == '#').count();
            if (1..=6).contains(&level) {
                let text = trimmed[level..].trim().to_string();
                if !text.is_empty() {
                    out.push(HeadingRef {
                        level,
                        text,
                        line: idx + 1,
                    });
                }
            }
        }
    }
    out
}

pub fn parse_hypha_links(body: &str) -> Vec<HyphaLinkRef> {
    let re = Regex::new(r"(!?)\[\[([^\[\]]+)\]\]").unwrap();
    let mut links = Vec::new();

    for (idx, line) in body.lines().enumerate() {
        for cap in re.captures_iter(line) {
            let is_embed = &cap[1] == "!";
            let inner = cap[2].trim();
            let raw = cap[0].to_string();

            let (target_and_heading, alias_opt) = if let Some((left, right)) = inner.split_once('|') {
                (left.trim(), Some(right.trim().to_string()))
            } else {
                (inner, None)
            };

            let (target_raw, heading) = if let Some((t, h)) = target_and_heading.split_once('#') {
                (t.trim().to_string(), Some(h.trim().to_string()))
            } else {
                (target_and_heading.to_string(), None)
            };

            if target_raw.is_empty() {
                continue;
            }

            let display_text = alias_opt.unwrap_or_else(|| target_raw.clone());
            let target_slug = normalize_id(&target_raw);
            let context = line
                .trim()
                .trim_start_matches('>')
                .trim()
                .to_string();

            links.push(WikiLinkRef {
                target: target_raw,
                target_slug,
                display_text,
                heading,
                is_embed,
                line: idx + 1,
                context,
                raw,
            });
        }
    }

    links
}

/// Backward compatibility alias
#[inline]
pub fn parse_wikilinks(body: &str) -> Vec<HyphaLinkRef> {
    parse_hypha_links(body)
}

pub fn parse_ai_segments(body: &str) -> Vec<AiSegment> {
    let mut segments = Vec::new();
    let lines: Vec<&str> = body.lines().collect();
    let callout_header_re =
        Regex::new(r"^>\s*\[!(ai|ai-draft|ai-unverified)\](?:[+-])?\s*(.*)$").unwrap();
    let inline_re = Regex::new(r"==\[AI(?::([^\]]+))?\]\s*(.+?)==").unwrap();

    let mut i = 0;
    let mut seg_counter = 1usize;

    while i < lines.len() {
        let line = lines[i].trim_start();
        if let Some(cap) = callout_header_re.captures(line) {
            let start_line = i + 1;
            let header_hint = cap
                .get(2)
                .map(|m| m.as_str().trim().to_string())
                .filter(|s| !s.is_empty());
            let mut raw_lines = vec![lines[i]];
            let mut content_lines = Vec::new();
            i += 1;
            while i < lines.len() {
                let next_trimmed = lines[i].trim_start();
                if let Some(stripped) = next_trimmed.strip_prefix('>') {
                    raw_lines.push(lines[i]);
                    content_lines.push(stripped.strip_prefix(' ').unwrap_or(stripped));
                    i += 1;
                } else {
                    break;
                }
            }
            let end_line = i;
            segments.push(AiSegment {
                id: format!("ai-seg-{}", seg_counter),
                kind: "callout".to_string(),
                content: content_lines.join("\n").trim().to_string(),
                start_line,
                end_line,
                raw_match: raw_lines.join("\n"),
                source_hint: header_hint,
            });
            seg_counter += 1;
            continue;
        }

        for cap in inline_re.captures_iter(lines[i]) {
            let source_hint = cap.get(1).map(|m| m.as_str().trim().to_string());
            let content = cap[2].trim().to_string();
            segments.push(AiSegment {
                id: format!("ai-seg-{}", seg_counter),
                kind: "inline".to_string(),
                content,
                start_line: i + 1,
                end_line: i + 1,
                raw_match: cap[0].to_string(),
                source_hint,
            });
            seg_counter += 1;
        }

        i += 1;
    }

    segments
}

pub fn verify_segment_in_markdown(raw_markdown: &str, segment_id: &str, verified_date: &str) -> String {
    let (_, _, _, _, body_slice) = parse_frontmatter(raw_markdown);
    let segments = parse_ai_segments(body_slice);
    let Some(target) = segments.iter().find(|s| s.id == segment_id) else {
        return raw_markdown.to_string();
    };

    let updated = if target.kind == "inline" {
        raw_markdown.replacen(&target.raw_match, &target.content, 1)
    } else {
        raw_markdown.replacen(&target.raw_match, &target.content, 1)
    };

    let (_, _, _, _, new_body) = parse_frontmatter(&updated);
    let remaining = parse_ai_segments(new_body);
    if remaining.is_empty() {
        update_frontmatter_status(&updated, "verified", Some(verified_date))
    } else {
        update_frontmatter_status(&updated, "partial", None)
    }
}

pub fn verify_entire_markdown(raw_markdown: &str, verified_date: &str) -> String {
    let mut current = raw_markdown.to_string();
    loop {
        let (_, _, _, _, body_slice) = parse_frontmatter(&current);
        let segments = parse_ai_segments(body_slice);
        let Some(first) = segments.first() else {
            break;
        };
        current = current.replacen(&first.raw_match, &first.content, 1);
    }
    update_frontmatter_status(&current, "verified", Some(verified_date))
}

pub fn update_frontmatter_status(
    raw_markdown: &str,
    new_status: &str,
    verified_date: Option<&str>,
) -> String {
    let normalized = raw_markdown.strip_prefix('\u{feff}').unwrap_or(raw_markdown);
    if normalized.starts_with("---\n") || normalized.starts_with("---\r\n") {
        let after_open = if normalized.starts_with("---\r\n") {
            &normalized[5..]
        } else {
            &normalized[4..]
        };
        if let Some(close_idx) = after_open.find("\n---\n").or_else(|| after_open.find("\n---\r\n")) {
            let yaml_part = &after_open[..close_idx];
            let rest = &after_open[close_idx..];

            let mut lines: Vec<String> = Vec::new();
            let mut has_status = false;
            let mut has_verified_at = false;

            for line in yaml_part.lines() {
                let trimmed = line.trim_start();
                if trimmed.starts_with("ai_status:") || trimmed.starts_with("status:") {
                    lines.push(format!("ai_status: {}", new_status));
                    has_status = true;
                } else if trimmed.starts_with("verified_at:") {
                    if let Some(d) = verified_date {
                        lines.push(format!("verified_at: {}", d));
                        has_verified_at = true;
                    } else {
                        lines.push(line.to_string());
                    }
                } else {
                    lines.push(line.to_string());
                }
            }

            if !has_status {
                lines.push(format!("ai_status: {}", new_status));
            }
            if !has_verified_at {
                if let Some(d) = verified_date {
                    lines.push(format!("verified_at: {}", d));
                }
            }

            return format!("---\n{}{}", lines.join("\n"), rest);
        }
    }

    let mut fm = format!("---\nai_status: {}\n", new_status);
    if let Some(d) = verified_date {
        fm.push_str(&format!("verified_at: {}\n", d));
    }
    fm.push_str("---\n\n");
    fm.push_str(normalized);
    fm
}

pub fn link_term_in_markdown(raw_markdown: &str, term: &str, target_title: &str) -> String {
    if term.trim().is_empty() {
        return raw_markdown.to_string();
    }
    let (_, _, _, _, body_slice) = parse_frontmatter(raw_markdown);
    let header_len = raw_markdown.len() - body_slice.len();
    let header = &raw_markdown[..header_len];

    let replacement = if term.eq_ignore_ascii_case(target_title) || term == target_title {
        format!("[[{}]]", target_title)
    } else {
        format!("[[{}|{}]]", target_title, term)
    };

    // Replace the first occurrence of `term` that is NOT already inside `[[...]]`
    let mut new_body = String::with_capacity(body_slice.len() + 16);
    let mut replaced = false;

    for line in body_slice.lines() {
        if replaced || line.trim_start().starts_with('#') {
            new_body.push_str(line);
            new_body.push('\n');
            continue;
        }

        if let Some(pos) = find_unlinked_position(line, term) {
            new_body.push_str(&line[..pos]);
            new_body.push_str(&replacement);
            new_body.push_str(&line[pos + term.len()..]);
            new_body.push('\n');
            replaced = true;
        } else {
            new_body.push_str(line);
            new_body.push('\n');
        }
    }

    if !body_slice.ends_with('\n') && new_body.ends_with('\n') {
        new_body.pop();
    }

    format!("{}{}", header, new_body)
}

pub fn find_unlinked_position(line: &str, term: &str) -> Option<usize> {
    if term.is_empty() || !line.contains(term) {
        return None;
    }

    // Collect existing [[...]] and %%...%% ranges on this line
    let mut bracket_ranges: Vec<(usize, usize)> = Vec::new();
    let re = Regex::new(r"!?\[\[[^\[\]]+\]\]|%%.*?%%").unwrap();
    for m in re.find_iter(line) {
        bracket_ranges.push((m.start(), m.end()));
    }

    let mut search_from = 0;
    while let Some(rel_idx) = line[search_from..].find(term) {
        let abs_start = search_from + rel_idx;
        let abs_end = abs_start + term.len();
        let inside_link = bracket_ranges
            .iter()
            .any(|&(s, e)| abs_start >= s && abs_end <= e);
        if !inside_link {
            return Some(abs_start);
        }
        search_from = abs_end;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_markdown_frontmatter_and_hypha_links() {
        let md = r#"---
title: Mycelium Network
aliases: [Wood Wide Web, เครือข่ายไมซีเลียม]
tags: [biology, fungi]
ai_status: partial
ai_source: claude-code
---

# Mycelium Network

Mycelium connects [[Trees|Forest Trees]] and transfers [[Carbon#Isotopes|Carbon Compounds]].
![[Fungi Diagram]]

> [!ai] Generated by Claude Code
> Mycelial networks can span [[Soil Ecology]] across hundreds of acres.

==[AI] Electrical impulses travel at 0.5 to 5 mm/s== across hyphae.
"#;

        let doc = parse_note("Mycelium Network.md", md, "2026-11-05");
        assert_eq!(doc.title, "Mycelium Network");
        assert_eq!(doc.aliases, vec!["Wood Wide Web", "เครือข่ายไมซีเลียม"]);
        assert_eq!(doc.tags, vec!["biology", "fungi"]);
        assert_eq!(doc.epistemic_status, EpistemicStatus::Partial);
        assert_eq!(doc.outgoing_links.len(), 4);
        assert_eq!(doc.outgoing_links[0].target, "Trees");
        assert_eq!(doc.outgoing_links[0].display_text, "Forest Trees");
        assert_eq!(doc.outgoing_links[1].heading, Some("Isotopes".to_string()));
        assert!(doc.outgoing_links[2].is_embed);
        assert_eq!(doc.ai_segments.len(), 2);
        assert_eq!(doc.ai_segments[0].kind, "callout");
        assert_eq!(doc.ai_segments[1].kind, "inline");
    }

    #[test]
    fn test_verify_segment_and_full_note() {
        let md = r#"---
title: Hyphae
ai_status: unverified
---

> [!ai] AI Research
> Hyphae are branching filaments of a [[Fungus]].

Normal text with ==[AI] chitin cell walls== inside."#;

        let after_first = verify_segment_in_markdown(md, "ai-seg-1", "2026-11-05");
        assert!(!after_first.contains("> [!ai]"));
        assert!(after_first.contains("Hyphae are branching filaments of a [[Fungus]]."));
        assert!(after_first.contains("ai_status: partial"));
        assert!(after_first.contains("==[AI] chitin cell walls=="));

        let after_all = verify_entire_markdown(&after_first, "2026-11-05");
        assert!(!after_all.contains("==[AI]"));
        assert!(after_all.contains("Normal text with chitin cell walls inside."));
        assert!(after_all.contains("ai_status: verified"));
        assert!(after_all.contains("verified_at: 2026-11-05"));
    }

    #[test]
    fn test_link_term_in_markdown_skips_existing_hypha_links() {
        let md = "---\ntitle: Forest\n---\n[[Spore]] dispersion and Spore germination.";
        let linked = link_term_in_markdown(md, "Spore", "Spore");
        assert_eq!(
            linked,
            "---\ntitle: Forest\n---\n[[Spore]] dispersion and [[Spore]] germination."
        );
    }
}
