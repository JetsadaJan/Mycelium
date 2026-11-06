import React from 'react';
import {
  BacklinkRef,
  GraphEdge,
  GraphNode,
  NoteDocument,
  UnlinkedMention,
  VerificationAuditEntry,
} from '../types/vault';
import { NodeMapCanvas } from './NodeMapCanvas';
import { normalizeId, stripMarkdownToPlainText } from '../lib/vaultEngine';
import {
  ArrowDownLeft,
  ArrowUpRight,
  History,
  Link2,
  ListTree,
  Maximize2,
  Sparkles,
  Unlink,
} from 'lucide-react';

interface ConnectionsInspectorProps {
  activeNote: NoteDocument;
  allNotes: NoteDocument[];
  backlinks: BacklinkRef[];
  unlinkedMentions: UnlinkedMention[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  verificationLog: VerificationAuditEntry[];
  colonyKey?: string;
  theme: 'dark' | 'light';
  onSelectNote: (targetIdOrTitle: string, createIfMissing?: boolean) => void;
  onLinkUnlinkedMention: (sourceNoteId: string, term: string, targetTitle: string) => void;
  onOpenFullGraph: () => void;
  onOpenAiResearch: (topic: string) => void;
}

export const ConnectionsInspector: React.FC<ConnectionsInspectorProps> = ({
  activeNote,
  allNotes,
  backlinks,
  unlinkedMentions,
  graphNodes,
  graphEdges,
  verificationLog,
  colonyKey,
  theme,
  onSelectNote,
  onLinkUnlinkedMention,
  onOpenFullGraph,
  onOpenAiResearch,
}) => {
  const noteBySlug = React.useMemo(() => {
    const map = new Map<string, NoteDocument>();
    for (const n of allNotes) {
      map.set(n.id, n);
      map.set(normalizeId(n.title), n);
      for (const a of n.aliases) {
        map.set(normalizeId(a), n);
      }
    }
    return map;
  }, [allNotes]);

  const outlineHeadings = React.useMemo(() => {
    const items: Array<{ level: number; text: string; slug: string }> = [];
    const lines = activeNote.body.split(/\r?\n/);
    let inFence = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (m) {
        const level = m[1].length;
        const text = m[2].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => a || t).trim();
        if (level === 1 && text.toLowerCase() === activeNote.title.trim().toLowerCase()) {
          continue;
        }
        items.push({
          level,
          text,
          slug: normalizeId(text),
        });
      }
    }
    return items;
  }, [activeNote.body, activeNote.title]);

  return (
    <aside className="sidebar-right">
      {/* Mini Local Node Map Card */}
      <div className="sidebar-section-header">
        <span>Local Cluster Map</span>
        <button
          type="button"
          className="btn-subtle"
          style={{ padding: '2px 7px', fontSize: 11 }}
          onClick={onOpenFullGraph}
        >
          <Maximize2 size={11} /> Expand Map
        </button>
      </div>
      <div
        className="inspector-card"
        style={{
          height: 220,
          padding: 0,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <NodeMapCanvas
          nodes={graphNodes}
          edges={graphEdges}
          activeNoteId={activeNote.id}
          colonyKey={colonyKey}
          theme={theme}
          mode="local"
          onModeChange={() => onOpenFullGraph()}
          onSelectNode={(nodeId, title, isStub) =>
            onSelectNote(isStub ? title : nodeId, isStub)
          }
          compact
        />
      </div>

      {/* 0. Document Outline (Table of Contents) */}
      {outlineHeadings.length > 0 && (
        <>
          <div className="sidebar-section-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <ListTree size={13} color="var(--hypha-link)" /> Outline ({outlineHeadings.length})
            </span>
          </div>
          <div
            className="inspector-card"
            style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px' }}
          >
            {outlineHeadings.map((h, idx) => (
              <div
                key={`${h.slug}-${idx}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  paddingLeft: Math.max(0, (h.level - 2) * 12),
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    const el = document.getElementById(`section-${h.slug}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    textAlign: 'left',
                    fontSize: h.level === 2 ? 12.5 : 11.5,
                    fontWeight: h.level === 2 ? 600 : 500,
                    color: h.level === 2 ? 'var(--text-primary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '3px 4px',
                    borderRadius: 6,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Scroll to #${h.text}`}
                >
                  {h.text}
                </button>
                <button
                  type="button"
                  className="btn-subtle"
                  style={{ padding: '1px 6px', fontSize: 9.5, opacity: 0.75 }}
                  onClick={() => {
                    navigator.clipboard?.writeText(`[[${activeNote.title}#${h.text}]]`);
                  }}
                  title={`Copy section Hypha [[${activeNote.title}#${h.text}]]`}
                >
                  #Link
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 1. Incoming Hyphae (Nodes pointing to this Node) */}
      <div className="sidebar-section-header">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <ArrowDownLeft size={13} color="var(--verified-emerald)" /> Incoming Hyphae (
          {backlinks.length})
        </span>
      </div>
      <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {backlinks.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            No incoming Hyphae connected to {activeNote.title} yet.
          </div>
        ) : (
          backlinks.map((bl, idx) => (
            <div
              key={`${bl.source_id}-${bl.line}-${idx}`}
              onClick={() => onSelectNote(bl.source_id)}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 12.5, color: 'var(--hypha-link)' }}>
                  {stripMarkdownToPlainText(bl.source_title)}
                </span>
                <span
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 10.5,
                    color: 'var(--text-muted)',
                  }}
                >
                  L{bl.line}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.45,
                }}
              >
                {stripMarkdownToPlainText(bl.context)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 2. Outgoing Hyphae (Nodes this Node points to) */}
      {(() => {
        const outgoingNodeLinks = activeNote.outgoing_links.filter(
          (out) =>
            !/\.(png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|ogg|m4a|flac|mp4|webm|mov|ogv|pdf)$/i.test(
              out.target.trim()
            )
        );
        return (
          <>
            <div className="sidebar-section-header">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ArrowUpRight size={13} color="var(--hypha-link)" /> Outgoing Hyphae (
                {outgoingNodeLinks.length})
              </span>
            </div>
            <div
              className="inspector-card"
              style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {outgoingNodeLinks.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  No outgoing Hyphae in this Node.
                </div>
              ) : (
                outgoingNodeLinks.map((out, idx) => {
                  const resolved = noteBySlug.get(out.target_slug);
                  const plainContext = stripMarkdownToPlainText(out.context);
                  return (
                    <div
                      key={`${out.target_slug}-${idx}`}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        padding: '7px 9px',
                        borderRadius: 6,
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            onSelectNote(resolved ? resolved.id : out.target, !resolved)
                          }
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 7,
                            fontSize: 12.5,
                            fontWeight: 500,
                            color: resolved ? 'var(--text-primary)' : 'var(--hypha-stub)',
                            padding: 0,
                            textAlign: 'left',
                          }}
                        >
                          <span
                            className={`status-dot ${
                              resolved ? resolved.epistemic_status : 'unverified'
                            }`}
                            style={
                              !resolved
                                ? {
                                    background: 'transparent',
                                    border: '1.5px dashed var(--hypha-stub)',
                                    boxShadow: 'none',
                                  }
                                : undefined
                            }
                          />
                          <span>{stripMarkdownToPlainText(out.target)}</span>
                        </button>

                        {!resolved ? (
                          <button
                            type="button"
                            className="btn-amber"
                            style={{ padding: '2px 7px', fontSize: 10.5 }}
                            onClick={() => onOpenAiResearch(out.target)}
                            title="Missing page — dispatch AI to research and create it"
                          >
                            <Sparkles size={10} /> AI Draft
                          </button>
                        ) : (
                          <span
                            style={{
                              fontFamily: '"JetBrains Mono", monospace',
                              fontSize: 10.5,
                              color: 'var(--text-muted)',
                            }}
                          >
                            {resolved.epistemic_status}
                          </span>
                        )}
                      </div>
                      {plainContext && (
                        <div
                          style={{
                            fontSize: 11,
                            color: 'var(--text-secondary)',
                            lineHeight: 1.4,
                          }}
                        >
                          {plainContext}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        );
      })()}

      {/* 3. Latent Hyphae (Unlinked Mentions across Colony) */}
      <div className="sidebar-section-header">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Unlink size={13} color="var(--ai-amber)" /> Latent Hyphae (
          {unlinkedMentions.length})
        </span>
      </div>
      <div className="inspector-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {unlinkedMentions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            All mentions of {activeNote.title} across the Colony are already connected via Hypha.
          </div>
        ) : (
          unlinkedMentions.map((um, idx) => (
            <div
              key={`${um.source_id}-${um.line}-${idx}`}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <span
                  onClick={() => onSelectNote(um.source_id)}
                  style={{
                    fontWeight: 600,
                    fontSize: 12.5,
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                  }}
                >
                  {stripMarkdownToPlainText(um.source_title)}
                </span>
                <button
                  type="button"
                  className="btn-subtle"
                  style={{ padding: '2px 7px', fontSize: 10.5 }}
                  onClick={() =>
                    onLinkUnlinkedMention(um.source_id, um.matched_term, activeNote.title)
                  }
                >
                  <Link2 size={10} /> Connect {um.matched_term}
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                {stripMarkdownToPlainText(um.context)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 4. Recent Verification Audit Trail */}
      {verificationLog.length > 0 && (
        <>
          <div className="sidebar-section-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <History size={13} /> Verification Audit Log
            </span>
          </div>
          <div
            className="inspector-card"
            style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}
          >
            {verificationLog.slice(0, 5).map((entry, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 11.5,
                  color: 'var(--text-secondary)',
                  borderBottom:
                    idx < Math.min(4, verificationLog.length - 1)
                      ? '1px solid var(--border-subtle)'
                      : 'none',
                  paddingBottom: 5,
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--verified-emerald)' }}>
                  ✓ {entry.detail}
                </div>
                <div
                  style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 10,
                    color: 'var(--text-muted)',
                  }}
                >
                  {entry.timestamp}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
};
