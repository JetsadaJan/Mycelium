use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EpistemicStatus {
    Verified,
    Partial,
    Unverified,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiSegment {
    pub id: String,
    pub kind: String, // "callout" | "inline"
    pub content: String,
    pub start_line: usize,
    pub end_line: usize,
    pub raw_match: String,
    pub source_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HyphaLinkRef {
    pub target: String,
    pub target_slug: String,
    pub display_text: String,
    pub heading: Option<String>,
    pub is_embed: bool,
    pub line: usize,
    pub context: String,
    pub raw: String,
}

/// Backward compatibility alias
pub type WikiLinkRef = HyphaLinkRef;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BacklinkRef {
    pub source_id: String,
    pub source_title: String,
    pub source_path: String,
    pub line: usize,
    pub context: String,
    pub display_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnlinkedMention {
    pub source_id: String,
    pub source_title: String,
    pub target_id: String,
    pub target_title: String,
    pub matched_term: String,
    pub line: usize,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeadingRef {
    pub level: usize,
    pub text: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NoteDocument {
    pub id: String,
    pub title: String,
    pub rel_path: String,
    pub folder: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub frontmatter: HashMap<String, String>,
    pub body: String,
    pub raw_markdown: String,
    pub epistemic_status: EpistemicStatus,
    pub ai_source: Option<String>,
    pub verified_at: Option<String>,
    pub sources: Vec<String>,
    pub ai_segments: Vec<AiSegment>,
    pub outgoing_links: Vec<HyphaLinkRef>,
    pub headings: Vec<HeadingRef>,
    pub word_count: usize,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub folder: String,
    pub tags: Vec<String>,
    pub epistemic_status: EpistemicStatus,
    pub ai_segment_count: usize,
    pub is_stub: bool,
    pub in_degree: usize,
    pub out_degree: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VerificationAuditEntry {
    pub timestamp: String,
    pub note_id: String,
    pub action: String, // "verify_segment" | "verify_note" | "mark_ai"
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultSnapshot {
    pub vault_path: String,
    pub notes: Vec<NoteDocument>,
    pub backlinks: HashMap<String, Vec<BacklinkRef>>,
    pub unlinked_mentions: HashMap<String, Vec<UnlinkedMention>>,
    pub graph_nodes: Vec<GraphNode>,
    pub graph_edges: Vec<GraphEdge>,
    pub verification_log: Vec<VerificationAuditEntry>,
}
