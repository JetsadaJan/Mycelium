export type EpistemicStatus = 'verified' | 'partial' | 'unverified';

export interface AiSegment {
  id: string;
  kind: 'callout' | 'inline';
  content: string;
  start_line: number;
  end_line: number;
  raw_match: string;
  source_hint?: string | null;
}

export interface WikiLinkRef {
  target: string;
  target_slug: string;
  display_text: string;
  heading?: string | null;
  is_embed: boolean;
  line: number;
  context: string;
  raw: string;
}

export interface BacklinkRef {
  source_id: string;
  source_title: string;
  source_path: string;
  line: number;
  context: string;
  display_text: string;
}

export interface UnlinkedMention {
  source_id: string;
  source_title: string;
  target_id: string;
  target_title: string;
  matched_term: string;
  line: number;
  context: string;
}

export interface HeadingRef {
  level: number;
  text: string;
  line: number;
}

export interface NoteDocument {
  id: string;
  title: string;
  rel_path: string;
  folder: string;
  aliases: string[];
  tags: string[];
  frontmatter: Record<string, string>;
  body: string;
  raw_markdown: string;
  epistemic_status: EpistemicStatus;
  ai_source?: string | null;
  verified_at?: string | null;
  sources: string[];
  ai_segments: AiSegment[];
  outgoing_links: WikiLinkRef[];
  headings: HeadingRef[];
  word_count: number;
  updated_at: string;
}

export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  tags: string[];
  epistemic_status: EpistemicStatus;
  ai_segment_count: number;
  is_stub: boolean;
  in_degree: number;
  out_degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string | null;
}

export interface VerificationAuditEntry {
  timestamp: string;
  note_id: string;
  action: string;
  detail: string;
}

export interface VaultSnapshot {
  vault_path: string;
  notes: NoteDocument[];
  backlinks: Record<string, BacklinkRef[]>;
  unlinked_mentions: Record<string, UnlinkedMention[]>;
  graph_nodes: GraphNode[];
  graph_edges: GraphEdge[];
  verification_log: VerificationAuditEntry[];
}

export interface AiResearchRequest {
  topic: string;
  mode: 'api' | 'ollama' | 'agent_wiki';
  api_url?: string;
  api_key?: string;
  model?: string;
  existing_titles: string[];
}

export interface AiResearchResponse {
  title: string;
  markdown_page: string;
  markdown_block: string;
  sources: string[];
  provider_used: string;
  agent_prompt: string;
}
