import React, { useMemo, useRef, useState } from 'react';
import {
  AiResearchRequest,
  AiResearchResponse,
  NoteDocument,
} from '../types/vault';
import {
  extractNoteSectionOrBlock,
  linkTermInMarkdown,
  markSelectionAsAiSafely,
  normalizeId,
  normalizeFormattedLinks,
  sanitizeBrowserSelectionForAi,
  serializeMarkdownLossless,
  stripMarkdownToPlainText,
  stripDelimitedComments,
  unmarkAiSpanSafely,
} from '../lib/vaultEngine';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Film,
  GitBranch,
  Heading2,
  Image as ImageIcon,
  Info,
  Link2,
  List,
  Maximize2,
  Music,
  PenTool,
  Plus,
  Redo2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';

const UPLOADED_ASSETS_STORAGE_KEY = 'mycelium_uploaded_assets_v1';
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|ogv|mkv)$/i;
const PDF_EXT_RE = /\.pdf(?:#.*)?$/i;

function getUploadedAssetDataUrl(relPath: string): string | null {
  try {
    const raw = localStorage.getItem(UPLOADED_ASSETS_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, string>;
    const clean = relPath.trim().replace(/^\//, '');
    return map[clean] || map[`assets/${clean}`] || null;
  } catch {
    return null;
  }
}

function saveUploadedAssetDataUrl(relPath: string, dataUrl: string) {
  try {
    const raw = localStorage.getItem(UPLOADED_ASSETS_STORAGE_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    const clean = relPath.trim().replace(/^\//, '');
    map[clean] = dataUrl;
    localStorage.setItem(UPLOADED_ASSETS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

function resolveColonyAssetSources(rawTarget: string): {
  primarySrc: string;
  fallbackSrc: string;
} {
  const trimmed = rawTarget.trim();
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return { primarySrc: trimmed, fallbackSrc: trimmed };
  }
  const uploaded = getUploadedAssetDataUrl(trimmed);
  if (uploaded) {
    return { primarySrc: uploaded, fallbackSrc: uploaded };
  }
  const cleanRel = trimmed.replace(/^\//, '');
  const rustUrl = `http://127.0.0.1:4174/api/asset?path=${encodeURIComponent(cleanRel)}`;
  const publicFallback = cleanRel.startsWith('assets/')
    ? `/${cleanRel}`
    : `/assets/${cleanRel}`;
  return { primarySrc: rustUrl, fallbackSrc: publicFallback };
}

function parseEmbedOptions(parts: string[]): {
  caption: string | null;
  widthPx: number | null;
  heightPx: number | null;
} {
  let caption: string | null = null;
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const dimMatch = p.match(/^(\d{2,4})(?:x(\d{2,4}))?$/);
    if (dimMatch) {
      widthPx = Number(dimMatch[1]);
      if (dimMatch[2]) {
        heightPx = Number(dimMatch[2]);
      }
    } else {
      caption = p;
    }
  }
  return { caption, widthPx, heightPx };
}

function extractYoutubeEmbedUrl(url: string): string | null {
  const m1 = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m1) {
    return `https://www.youtube.com/embed/${m1[1]}`;
  }
  return null;
}

function formatLatexMath(raw: string): string {
  const symbols: Record<string, string> = {
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\delta': 'δ',
    '\\epsilon': 'ε',
    '\\theta': 'θ',
    '\\lambda': 'λ',
    '\\mu': 'μ',
    '\\pi': 'π',
    '\\sigma': 'σ',
    '\\tau': 'τ',
    '\\phi': 'φ',
    '\\omega': 'ω',
    '\\Delta': 'Δ',
    '\\Sigma': 'Σ',
    '\\Omega': 'Ω',
    '\\sum': '∑',
    '\\int': '∫',
    '\\prod': '∏',
    '\\infty': '∞',
    '\\approx': '≈',
    '\\neq': '≠',
    '\\leq': '≤',
    '\\geq': '≥',
    '\\pm': '±',
    '\\times': '×',
    '\\cdot': '·',
    '\\rightarrow': '→',
    '\\to': '→',
    '\\leftarrow': '←',
    '\\leftrightarrow': '↔',
    '\\Rightarrow': '⇒',
    '\\in': '∈',
    '\\forall': '∀',
    '\\exists': '∃',
    '\\nabla': '∇',
    '\\partial': '∂',
  };
  let out = raw.trim();
  out = out.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)');
  out = out.replace(/\\sqrt\{([^}]+)\}/g, '√($1)');
  out = out.replace(/\\text\{([^}]+)\}/g, '$1');
  for (const [k, v] of Object.entries(symbols)) {
    out = out.split(k).join(v);
  }
  return out;
}

function extractMarkdownSection(body: string, headingName: string): string {
  const lines = body.split(/\r?\n/);
  const targetSlug = normalizeId(headingName);
  let capturing = false;
  let captureLevel = 6;
  const captured: string[] = [];

  for (const line of lines) {
    const m = line.trim().match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      const lvl = m[1].length;
      const textSlug = normalizeId(m[2]);
      if (!capturing && textSlug === targetSlug) {
        capturing = true;
        captureLevel = lvl;
        continue;
      } else if (capturing && lvl <= captureLevel) {
        break;
      }
    }
    if (capturing) {
      captured.push(line);
    }
  }
  return captured.join('\n').trim();
}

const MermaidDiagramBlock: React.FC<{
  code: string;
  onNavigateToNote?: (title: string) => void;
}> = ({ code }) => {
  const [showSource, setShowSource] = useState(false);

  const parsed = useMemo(() => {
    const lines = code
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('%%'));
    const header = lines[0] || 'graph LR';
    const isVertical = /\b(TD|TB)\b/i.test(header);

    const nodeMap = new Map<string, { id: string; label: string }>();
    const edges: Array<{ from: string; to: string; edgeLabel?: string }> = [];

    const ensureNode = (rawToken: string): string => {
      const clean = rawToken.trim();
      const m = clean.match(/^([A-Za-z0-9_]+)\s*(?:\["?([^"\]]+)"?\]|\("?([^"\)]+)"?\)|\{([^}]+)\})?$/);
      if (m) {
        const id = m[1];
        const label = (m[2] || m[3] || m[4] || id).trim();
        if (!nodeMap.has(id) || label !== id) {
          nodeMap.set(id, { id, label });
        }
        return id;
      }
      if (!nodeMap.has(clean)) {
        nodeMap.set(clean, { id: clean, label: clean });
      }
      return clean;
    };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const edgeMatch = line.match(
        /^(.+?)\s*(?:-->|---|-\.->|==>)\s*(?:\|([^|]+)\|\s*)?(.+)$/
      );
      if (edgeMatch) {
        const fromId = ensureNode(edgeMatch[1]);
        const edgeLabel = edgeMatch[2]?.trim();
        const toId = ensureNode(edgeMatch[3]);
        edges.push({ from: fromId, to: toId, edgeLabel });
      }
    }

    const nodes = Array.from(nodeMap.values());
    return { isVertical, nodes, edges };
  }, [code]);

  if (parsed.nodes.length === 0) {
    return (
      <pre
        style={{
          padding: 14,
          borderRadius: 14,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-subtle)',
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12.5,
          overflowX: 'auto',
        }}
      >
        {code}
      </pre>
    );
  }

  // Compute clean coordinates for nodes
  const width = 760;
  const height = parsed.isVertical ? Math.max(240, parsed.nodes.length * 68) : 210;
  const positions = new Map<string, { x: number; y: number }>();

  parsed.nodes.forEach((n, idx) => {
    if (parsed.isVertical) {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      positions.set(n.id, {
        x: parsed.nodes.length <= 4 ? width / 2 : col === 0 ? 230 : 530,
        y: 50 + row * 78,
      });
    } else {
      const total = parsed.nodes.length;
      const xStep = (width - 160) / Math.max(1, total - 1);
      const yOffset = idx % 2 === 0 ? 78 : 138;
      positions.set(n.id, {
        x: 80 + idx * xStep,
        y: total <= 3 ? 105 : yOffset,
      });
    }
  });

  return (
    <div
      style={{
        margin: '20px 0',
        borderRadius: 16,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-subtle)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: 11.5,
          color: 'var(--text-muted)',
          fontFamily: '"JetBrains Mono", monospace',
        }}
      >
        <span>Mermaid Flowchart Diagram</span>
        <button
          type="button"
          className="btn-subtle"
          style={{ padding: '2px 8px', fontSize: 10.5 }}
          onClick={() => setShowSource((v) => !v)}
        >
          {showSource ? 'View Diagram' : 'Source'}
        </button>
      </div>

      {showSource ? (
        <pre
          style={{
            margin: 0,
            padding: 14,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 12,
            overflowX: 'auto',
          }}
        >
          {code}
        </pre>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
          <defs>
            <marker
              id="mermaid-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#818cf8" />
            </marker>
          </defs>

          {parsed.edges.map((e, idx) => {
            const p1 = positions.get(e.from);
            const p2 = positions.get(e.to);
            if (!p1 || !p2) return null;
            return (
              <g key={idx}>
                <line
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#818cf8"
                  strokeOpacity={0.65}
                  strokeWidth={2}
                  markerEnd="url(#mermaid-arrow)"
                />
                {e.edgeLabel && (
                  <text
                    x={(p1.x + p2.x) / 2}
                    y={(p1.y + p2.y) / 2 - 6}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="10"
                    fontFamily="system-ui, sans-serif"
                  >
                    {e.edgeLabel}
                  </text>
                )}
              </g>
            );
          })}

          {parsed.nodes.map((n, idx) => {
            const pos = positions.get(n.id);
            if (!pos) return null;
            const boxW = Math.max(108, Math.min(180, n.label.length * 7.2 + 24));
            const boxH = 34;
            const accent =
              idx === 0 ? '#10b981' : idx === parsed.nodes.length - 1 ? '#f59e0b' : '#818cf8';
            return (
              <g key={n.id} transform={`translate(${pos.x - boxW / 2}, ${pos.y - boxH / 2})`}>
                <rect
                  width={boxW}
                  height={boxH}
                  rx={999}
                  fill="#161d29"
                  stroke={accent}
                  strokeWidth={1.6}
                />
                <text
                  x={boxW / 2}
                  y={boxH / 2 + 4}
                  textAnchor="middle"
                  fill="#f1f5f9"
                  fontSize="11.5"
                  fontWeight="600"
                  fontFamily="system-ui, sans-serif"
                >
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

export interface NodeDocumentViewProps {
  note: NoteDocument;
  allNotes: NoteDocument[];
  mode: 'read' | 'write';
  onModeChange: (mode: 'read' | 'write') => void;
  onNavigateToNote: (targetTitleOrId: string, createIfMissing?: boolean) => void;
  onVerifySegment: (segmentId: string) => void;
  onVerifyEntireNote: () => void;
  onLinkTerm: (term: string, targetTitle: string) => void;
  onCreateBackgroundNote?: (targetTitle: string, linkTermFirst?: string) => Promise<void>;
  onSaveRawMarkdown: (rawMarkdown: string) => void;
  onRenameAndRefactorNote?: (newTitle: string, newRawMarkdown: string) => void;
  onDuplicateNote?: () => void;
  onDeleteNote?: () => void;
  onRunAiResearch: (req: AiResearchRequest) => Promise<AiResearchResponse>;
  onSelectCluster?: (clusterTag: string) => void;
  onDirtyChange?: (isDirty: boolean, saveDraft: () => void, discardDraft: () => void) => void;
}

interface HoverPreviewState {
  candidates: NoteDocument[];
  stubTitle: string | null;
  matchedTerm?: string;
  isUnlinkedEntity?: boolean;
  x: number;
  y: number;
}

function buildMarkdownFromStructuredFields(
  originalRaw: string,
  title: string,
  scope: string,
  aliasesStr: string,
  tagsStr: string,
  sourcesStr: string,
  bodyContent: string,
  existingNote: NoteDocument
): string {
  return serializeMarkdownLossless({
    originalRaw,
    title,
    scope,
    aliasesStr,
    tagsStr,
    sourcesStr,
    bodyContent,
    existingNote,
  });
}

function stripLeadingTitleHeading(body: string, title: string): string {
  const lines = body.split(/\r?\n/);
  let idx = 0;
  while (idx < lines.length && !lines[idx].trim()) idx++;
  if (idx < lines.length) {
    const m = lines[idx].trim().match(/^#\s+(.+)$/);
    if (m && m[1].trim().toLowerCase() === title.trim().toLowerCase()) {
      return lines
        .slice(idx + 1)
        .join('\n')
        .replace(/^\n+/, '');
    }
  }
  return body.trimStart();
}

export const NodeDocumentView: React.FC<NodeDocumentViewProps> = ({
  note,
  allNotes,
  mode,
  onModeChange,
  onNavigateToNote,
  onVerifySegment,
  onVerifyEntireNote,
  onLinkTerm,
  onCreateBackgroundNote,
  onSaveRawMarkdown,
  onRenameAndRefactorNote,
  onDuplicateNote,
  onDeleteNote,
  onRunAiResearch,
  onSelectCluster,
  onDirtyChange,
}) => {
  // Structured in-place editor states (so Write Node looks just like Read Node!)
  const [editTitle, setEditTitle] = useState<string>(note.title);
  const [editScope, setEditScope] = useState<string>(note.frontmatter.scope || '');
  const [editAliases, setEditAliases] = useState<string>(note.aliases.join(', '));
  const [editTags, setEditTags] = useState<string>(note.tags.join(', '));
  const [editSources, setEditSources] = useState<string>(note.sources.join('\n'));
  const [editBody, setEditBody] = useState<string>(() =>
    stripLeadingTitleHeading(note.body, note.title)
  );
  // Write Sub-Modes: 'live-preview' (line-by-line!) | 'continuous' (Code Editor, Live Preview OFF) | 'raw-yaml'
  const [writeSubMode, setWriteSubMode] = useState<'live-preview' | 'continuous' | 'raw-yaml'>(
    () => {
      try {
        const saved = localStorage.getItem('mycelium_write_submode_v1');
        if (saved === 'live-preview' || saved === 'continuous' || saved === 'raw-yaml') {
          return saved;
        }
      } catch {
        // ignore storage errors
      }
      return 'live-preview';
    }
  );
  const changeWriteSubMode = (nextMode: 'live-preview' | 'continuous' | 'raw-yaml') => {
    setWriteSubMode(nextMode);
    setActiveLiveLineIdx(null);
    setInlineTrigger(null);
    try {
      localStorage.setItem('mycelium_write_submode_v1', nextMode);
    } catch {
      // ignore storage errors
    }
  };
  const [showSyntaxGuide, setShowSyntaxGuide] = useState<boolean>(false);
  const codeEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeLiveLineIdx, setActiveLiveLineIdx] = useState<number | null>(null);
  const [inlineTrigger, setInlineTrigger] = useState<{
    kind: 'hypha' | 'cluster' | 'slash';
    query: string;
  } | null>(null);
  const [rawDraft, setRawDraft] = useState<string>(note.raw_markdown);

  // Reading Interactive States
  const [showPropertiesDrawer, setShowPropertiesDrawer] = useState<boolean>(false);
  const [foldedHeadings, setFoldedHeadings] = useState<Record<string, boolean>>({});
  const [foldedCallouts, setFoldedCallouts] = useState<Record<string, boolean>>({});
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [confirmDeleteNodeOpen, setConfirmDeleteNodeOpen] = useState<boolean>(false);

  // Subtle compact AI helper popover inside Write Node
  const [showCompactAi, setShowCompactAi] = useState<boolean>(false);
  const [compactAiTopic, setCompactAiTopic] = useState<string>('');
  const [compactAiLoading, setCompactAiLoading] = useState<boolean>(false);

  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null);
  const [selectedText, setSelectedText] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [connectHyphaPrompt, setConnectHyphaPrompt] = useState<{
    term: string;
  } | null>(null);
  const [stubUnavailablePill, setStubUnavailablePill] = useState<{
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [readUndoStack, setReadUndoStack] = useState<Array<{ markdown: string; label: string }>>([]);
  const [readRedoStack, setReadRedoStack] = useState<Array<{ markdown: string; label: string }>>([]);
  const [writeUndoStack, setWriteUndoStack] = useState<string[]>([]);
  const [writeRedoStack, setWriteRedoStack] = useState<string[]>([]);

  const pushWriteHistory = (nextBody: string) => {
    setWriteUndoStack((prev) => [...prev.slice(-39), editBody]);
    setWriteRedoStack([]);
    setEditBody(nextBody);
  };

  const commitReadMarkdownWithUndo = (nextMarkdown: string, label: string) => {
    const normalizedNext = normalizeFormattedLinks(nextMarkdown);
    if (normalizedNext === note.raw_markdown) return false;
    setReadUndoStack((prev) => [...prev.slice(-39), { markdown: note.raw_markdown, label }]);
    setReadRedoStack([]);
    onSaveRawMarkdown(normalizedNext);
    setStatusToast(label);
    setTimeout(() => setStatusToast(null), 3200);
    return true;
  };

  const commitLinkTermWithUndo = (term: string, targetTitle: string) => {
    const linked = linkTermInMarkdown(note.raw_markdown, term, targetTitle);
    if (linked !== note.raw_markdown) {
      commitReadMarkdownWithUndo(linked, `Connected Hypha [[${targetTitle}]]`);
    } else {
      onLinkTerm(term, targetTitle);
    }
  };

  const handleUndo = () => {
    if (mode === 'read') {
      if (readUndoStack.length === 0) return;
      const last = readUndoStack[readUndoStack.length - 1];
      setReadUndoStack((prev) => prev.slice(0, -1));
      setReadRedoStack((prev) => [...prev, { markdown: note.raw_markdown, label: last.label }]);
      onSaveRawMarkdown(last.markdown);
      setStatusToast(`Undid: ${last.label}`);
      setTimeout(() => setStatusToast(null), 2400);
    } else {
      if (writeUndoStack.length === 0) return;
      const prevBody = writeUndoStack[writeUndoStack.length - 1];
      setWriteUndoStack((prev) => prev.slice(0, -1));
      setWriteRedoStack((prev) => [...prev, editBody]);
      setEditBody(prevBody);
      setStatusToast('Undid last write edit');
      setTimeout(() => setStatusToast(null), 1800);
    }
  };

  const handleRedo = () => {
    if (mode === 'read') {
      if (readRedoStack.length === 0) return;
      const next = readRedoStack[readRedoStack.length - 1];
      setReadRedoStack((prev) => prev.slice(0, -1));
      setReadUndoStack((prev) => [...prev, { markdown: note.raw_markdown, label: next.label }]);
      onSaveRawMarkdown(next.markdown);
      setStatusToast(`Redid: ${next.label}`);
      setTimeout(() => setStatusToast(null), 2400);
    } else {
      if (writeRedoStack.length === 0) return;
      const nextBody = writeRedoStack[writeRedoStack.length - 1];
      setWriteRedoStack((prev) => prev.slice(0, -1));
      setWriteUndoStack((prev) => [...prev, editBody]);
      setEditBody(nextBody);
      setStatusToast('Redid write edit');
      setTimeout(() => setStatusToast(null), 1800);
    }
  };

  const canUndo = mode === 'read' ? readUndoStack.length > 0 : writeUndoStack.length > 0;
  const canRedo = mode === 'read' ? readRedoStack.length > 0 : writeRedoStack.length > 0;

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
        mode === 'write'
      ) {
        return; // Let native textarea undo work while typing inside an active input, or use toolbar button
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          if (canRedo) {
            e.preventDefault();
            handleRedo();
          }
        } else if (canUndo) {
          e.preventDefault();
          handleUndo();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, canUndo, canRedo, readUndoStack, readRedoStack, writeUndoStack, writeRedoStack, note.raw_markdown, editBody]);
  const [selectedHyphaTarget, setSelectedHyphaTarget] = useState<string>('');
  const [selectedEmbedTarget, setSelectedEmbedTarget] = useState<string>('');
  const [lightboxMedia, setLightboxMedia] = useState<{
    src: string;
    caption: string;
  } | null>(null);
  const mediaFileInputRef = useRef<HTMLInputElement | null>(null);

  // Compute all existing Cluster tags (#tags) in this Colony with node counts (for anti-typo suggestions!)
  const colonyClusters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of allNotes) {
      for (const rawTag of n.tags) {
        const clean = rawTag.trim().replace(/^#/, '');
        if (!clean) continue;
        counts.set(clean, (counts.get(clean) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [allNotes]);

  const currentTagList = useMemo(
    () =>
      editTags
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean),
    [editTags]
  );

  // Last partial tag being typed for instant autocomplete matching
  const partialTagQuery = useMemo(() => {
    const parts = editTags.split(',');
    return (parts[parts.length - 1] || '').trim().replace(/^#/, '').toLowerCase();
  }, [editTags]);

  const toggleClusterTagInEditor = (tag: string) => {
    const clean = tag.trim().replace(/^#/, '');
    if (!clean) return;
    if (currentTagList.includes(clean)) {
      const next = currentTagList.filter((t) => t !== clean);
      setEditTags(next.join(', '));
    } else {
      // If user was halfway through typing a prefix of this tag at the end, replace the partial token
      const parts = editTags
        .split(',')
        .map((s) => s.trim().replace(/^#/, ''))
        .filter(Boolean);
      if (
        parts.length > 0 &&
        clean.toLowerCase().startsWith(parts[parts.length - 1].toLowerCase()) &&
        !colonyClusters.some(([exact]) => exact === parts[parts.length - 1])
      ) {
        parts[parts.length - 1] = clean;
        setEditTags(Array.from(new Set(parts)).join(', '));
      } else {
        setEditTags([...currentTagList, clean].join(', '));
      }
    }
  };

  const handleMediaFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const relPath = `assets/${file.name}`;
      if (dataUrl) {
        saveUploadedAssetDataUrl(relPath, dataUrl);
        saveUploadedAssetDataUrl(file.name, dataUrl);
        const commaIdx = dataUrl.indexOf(',');
        const base64Data = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : '';
        if (base64Data) {
          try {
            await fetch('http://127.0.0.1:4174/api/asset/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: file.name,
                base64_data: base64Data,
              }),
            });
          } catch {
            // Local storage dataUrl fallback already saved
          }
        }
      }
      insertIntoBody(`![[${relPath}|${file.name.replace(/\.[^.]+$/, '')}]]`);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const resetDraftToSaved = React.useCallback(() => {
    setEditTitle(note.title);
    setEditScope(note.frontmatter.scope || '');
    setEditAliases(note.aliases.join(', '));
    setEditTags(note.tags.join(', '));
    setEditSources(note.sources.join('\n'));
    setEditBody(stripLeadingTitleHeading(note.body, note.title));
    setRawDraft(note.raw_markdown);
    setActiveLiveLineIdx(null);
    setInlineTrigger(null);
    setSelectedText(null);
    setHoverPreview(null);
  }, [note]);

  React.useEffect(() => {
    resetDraftToSaved();
  }, [note.id, note.raw_markdown, note.title, resetDraftToSaved]);

  const isWriteDirty = useMemo(() => {
    if (mode !== 'write') return false;
    if (writeSubMode === 'raw-yaml') {
      return rawDraft.trim() !== note.raw_markdown.trim();
    }
    const origBody = stripLeadingTitleHeading(note.body, note.title).trim();
    return (
      editTitle.trim() !== note.title.trim() ||
      editScope.trim() !== (note.frontmatter.scope || '').trim() ||
      editAliases.trim() !== note.aliases.join(', ').trim() ||
      editTags.trim() !== note.tags.join(', ').trim() ||
      editSources.trim() !== note.sources.join('\n').trim() ||
      editBody.trim() !== origBody
    );
  }, [
    mode,
    writeSubMode,
    rawDraft,
    note,
    editTitle,
    editScope,
    editAliases,
    editTags,
    editSources,
    editBody,
  ]);

  // Build multi-target entity & disambiguation catalog
  const entityCatalog = useMemo(() => {
    const byExactSlug = new Map<string, NoteDocument>();
    const byTermMulti = new Map<string, NoteDocument[]>();

    const addCandidate = (key: string, doc: NoteDocument) => {
      const slug = normalizeId(key);
      if (!slug) return;
      const list = byTermMulti.get(slug) || [];
      if (!list.some((item) => item.id === doc.id)) {
        list.push(doc);
        byTermMulti.set(slug, list);
      }
    };

    for (const n of allNotes) {
      byExactSlug.set(n.id, n);
      byExactSlug.set(normalizeId(n.title), n);
      if (n.rel_path) {
        byExactSlug.set(normalizeId(n.rel_path), n);
        addCandidate(n.rel_path, n);
      }
      addCandidate(n.title, n);
      // Base title before parentheses e.g. "Hypha (Biology)" -> "Hypha"
      const baseTitle = n.title.replace(/\s*\([^)]+\)\s*$/, '').trim();
      if (baseTitle && baseTitle !== n.title) {
        addCandidate(baseTitle, n);
      }
      for (const a of n.aliases) {
        addCandidate(a, n);
      }
    }

    const detectableTerms: Array<{ term: string; candidates: NoteDocument[] }> = [];
    const seenTerms = new Set<string>();

    for (const n of allNotes) {
      const termsForNote = [
        n.title,
        n.title.replace(/\s*\([^)]+\)\s*$/, '').trim(),
        ...n.aliases,
      ];
      for (const rawTerm of termsForNote) {
        const clean = rawTerm.trim();
        if (clean.length < 3 || seenTerms.has(clean)) continue;
        const candidates = (byTermMulti.get(normalizeId(clean)) || []).filter(
          (cand) => cand.id !== note.id
        );
        if (candidates.length > 0) {
          seenTerms.add(clean);
          detectableTerms.push({ term: clean, candidates });
        }
      }
    }

    detectableTerms.sort((a, b) => b.term.length - a.term.length);
    return { byExactSlug, byTermMulti, detectableTerms };
  }, [allNotes, note.id]);

  // Sibling Disambiguation Nodes for the currently open Node (e.g. Hypha (Biology) <-> Hypha (Mycelium Engine))
  const disambiguationSiblings = useMemo(() => {
    const siblings = new Map<string, NoteDocument>();
    const baseTitle = note.title.replace(/\s*\([^)]+\)\s*$/, '').trim();
    const keysToCheck = [baseTitle, ...note.aliases];
    if (note.frontmatter.disambiguation) {
      keysToCheck.push(note.frontmatter.disambiguation);
    }

    for (const key of keysToCheck) {
      const matches = entityCatalog.byTermMulti.get(normalizeId(key)) || [];
      for (const m of matches) {
        if (m.id !== note.id) {
          siblings.set(m.id, m);
        }
      }
    }
    return Array.from(siblings.values());
  }, [note, entityCatalog]);

  const handleSaveStructured = (switchToRead = false) => {
    const cleanNewTitle = editTitle.trim() || note.title;
    const finalMd =
      writeSubMode === 'raw-yaml'
        ? rawDraft
        : buildMarkdownFromStructuredFields(
            note.raw_markdown,
            cleanNewTitle,
            editScope,
            editAliases,
            editTags,
            editSources,
            editBody,
            note
          );

    if (cleanNewTitle !== note.title && onRenameAndRefactorNote) {
      onRenameAndRefactorNote(cleanNewTitle, finalMd);
      setStatusToast(
        `Renamed to "${cleanNewTitle}.md" & auto-updated [[Hyphae]] across Colony`
      );
      setTimeout(() => setStatusToast(null), 3600);
    } else {
      onSaveRawMarkdown(finalMd);
      setStatusToast(`Saved "${cleanNewTitle}.md"`);
      setTimeout(() => setStatusToast(null), 2400);
    }
    if (switchToRead) {
      setActiveLiveLineIdx(null);
      setInlineTrigger(null);
      onModeChange('read');
    }
  };

  React.useEffect(() => {
    onDirtyChange?.(
      isWriteDirty,
      () => handleSaveStructured(false),
      () => resetDraftToSaved()
    );
  }, [isWriteDirty]);

  const handleRemoveAiFlag = (rawAiMatch: string, _plainText: string) => {
    const nextRaw = unmarkAiSpanSafely(note.raw_markdown, rawAiMatch);
    if (nextRaw !== note.raw_markdown) {
      commitReadMarkdownWithUndo(nextRaw, 'Removed AI flag and restored standard prose');
    }
  };

  const handleToggleCheckbox = (taskLabel: string, currentlyChecked: boolean) => {
    const escaped = taskLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `^(\\s*[-*+]\\s+\\[)${currentlyChecked ? '[xX]' : ' '}(\\]\\s+${escaped})`,
      'm'
    );
    const replacement = `$1${currentlyChecked ? ' ' : 'x'}$2`;
    const nextRaw = note.raw_markdown.replace(re, replacement);
    if (nextRaw !== note.raw_markdown) {
      commitReadMarkdownWithUndo(
        nextRaw,
        `${currentlyChecked ? 'Unchecked' : 'Completed'} task "${taskLabel.slice(0, 28)}"`
      );
      setEditBody((prev) => prev.replace(re, replacement));
    }
  };

  const handleExportMarkdownFile = () => {
    const blob = new Blob([note.raw_markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = note.rel_path.split('/').pop() || `${note.title}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const detectInlineTrigger = (text: string) => {
    const hyphaMatch = text.match(/\[\[([^\[\]]*)$/);
    if (hyphaMatch) {
      setInlineTrigger({ kind: 'hypha', query: hyphaMatch[1] });
      return;
    }
    const clusterMatch = text.match(/(?:^|\s)#([a-zA-Z0-9_-]*)$/);
    if (clusterMatch) {
      setInlineTrigger({ kind: 'cluster', query: clusterMatch[1] });
      return;
    }
    const slashMatch = text.match(/(?:^|\n)\/([a-zA-Z0-9_-]*)$/);
    if (slashMatch) {
      setInlineTrigger({ kind: 'slash', query: slashMatch[1] });
      return;
    }
    setInlineTrigger(null);
  };

  const applyInlineAutocomplete = (
    currentLineText: string,
    replacementValue: string
  ): string => {
    if (!inlineTrigger) return currentLineText;
    if (inlineTrigger.kind === 'hypha') {
      return currentLineText.replace(/\[\[([^\[\]]*)$/, `[[${replacementValue}]]`);
    }
    if (inlineTrigger.kind === 'cluster') {
      return currentLineText.replace(/(^|\s)#([a-zA-Z0-9_-]*)$/, `$1#${replacementValue} `);
    }
    if (inlineTrigger.kind === 'slash') {
      return currentLineText.replace(/(^|\n)\/([a-zA-Z0-9_-]*)$/, `$1${replacementValue}`);
    }
    return currentLineText;
  };

  const insertIntoBody = (snippet: string, inline = false) => {
    if (writeSubMode === 'raw-yaml') {
      setRawDraft((prev) =>
        inline ? `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${snippet}` : `${prev.trimEnd()}\n\n${snippet}\n`
      );
      return;
    }
    if (writeSubMode === 'continuous' && codeEditorRef.current) {
      const el = codeEditorRef.current;
      const start = el.selectionStart ?? editBody.length;
      const end = el.selectionEnd ?? editBody.length;
      const before = editBody.slice(0, start);
      const after = editBody.slice(end);
      const prefix = !inline && before.length > 0 && !before.endsWith('\n') ? '\n\n' : '';
      const suffix = !inline && after.length > 0 && !after.startsWith('\n') ? '\n' : '';
      const inserted = `${prefix}${snippet}${suffix}`;
      const next = normalizeFormattedLinks(`${before}${inserted}${after}`);
      pushWriteHistory(next);
      requestAnimationFrame(() => {
        el.focus();
        const cursor = start + inserted.length;
        el.setSelectionRange(cursor, cursor);
      });
      return;
    }
    if (writeSubMode === 'live-preview' && activeLiveLineIdx !== null) {
      const currentLine = livePreviewLines[activeLiveLineIdx] ?? '';
      const sep = inline && currentLine && !currentLine.endsWith(' ') ? ' ' : inline ? '' : '\n';
      updateLiveLineAt(activeLiveLineIdx, currentLine ? `${currentLine}${sep}${snippet}` : snippet);
      return;
    }
    pushWriteHistory(
      normalizeFormattedLinks(
        inline ? `${editBody.trimEnd()} ${snippet}` : `${editBody.trimEnd()}\n\n${snippet}\n`
      )
    );
  };

  const handleMouseUpSelection = (e?: React.MouseEvent) => {
    if (mode !== 'read') return;
    if (e && (e.target as HTMLElement)?.closest('button, a, input, textarea, select')) {
      return;
    }
    const sel = window.getSelection();
    const raw = sel?.toString() || '';
    const text = sanitizeBrowserSelectionForAi(raw);
    if (text.length >= 2 && text.length <= 280) {
      const range = sel?.getRangeAt(0);
      const rect = range?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        setConnectHyphaPrompt(null);
        setSelectedText({
          text,
          x: rect.left + rect.width / 2,
          y: Math.max(68, rect.top - 10),
        });
        return;
      }
    }
    setConnectHyphaPrompt(null);
    setSelectedText(null);
  };

  const renderEmbed = (
    rawInner: string,
    keyPrefix: string
  ): React.ReactNode => {
    const parts = rawInner.split('|').map((s) => s.trim());
    const targetRaw = parts[0] || '';
    const { caption, widthPx, heightPx } = parseEmbedOptions(parts.slice(1));
    const [targetPathNoAnchor] = targetRaw.split('#').map((s) => s.trim());

    // 1. Image / SVG Embed
    if (IMAGE_EXT_RE.test(targetPathNoAnchor)) {
      const { primarySrc, fallbackSrc } = resolveColonyAssetSources(targetPathNoAnchor);
      const displayCaption =
        caption ||
        targetPathNoAnchor
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '')
          .replace(/[-_]/g, ' ') ||
        targetPathNoAnchor;

      return (
        <figure
          key={keyPrefix}
          style={{
            margin: '20px 0',
            padding: 12,
            borderRadius: 16,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            maxWidth: widthPx ? `${widthPx}px` : '100%',
          }}
        >
          <div style={{ position: 'relative' }}>
            <img
              src={primarySrc}
              alt={displayCaption}
              style={{
                width: '100%',
                height: heightPx ? `${heightPx}px` : 'auto',
                objectFit: heightPx ? 'cover' : undefined,
                borderRadius: 12,
                display: 'block',
                cursor: 'zoom-in',
              }}
              onClick={(e) => {
                e.stopPropagation();
                setLightboxMedia({
                  src: e.currentTarget.currentSrc || primarySrc,
                  caption: displayCaption,
                });
              }}
              onError={(e) => {
                const img = e.currentTarget;
                if (img.src !== window.location.origin + fallbackSrc && !img.dataset.retried) {
                  img.dataset.retried = '1';
                  img.src = fallbackSrc;
                }
              }}
            />
            <button
              type="button"
              className="btn-subtle"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxMedia({ src: primarySrc, caption: displayCaption });
              }}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                padding: '4px 8px',
                fontSize: 11,
                background: 'rgba(15, 23, 42, 0.78)',
                color: '#f8fafc',
                border: '1px solid rgba(255,255,255,0.16)',
              }}
              title="Expand Media in Lightbox"
            >
              <Maximize2 size={11} /> Inspect
            </button>
          </div>
          <figcaption
            style={{
              marginTop: 10,
              fontSize: 12,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ImageIcon size={13} color="var(--verified-emerald)" />
              {displayCaption}
            </span>
            <span
              style={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 10.5,
                color: 'var(--text-muted)',
              }}
            >
              ![[{targetPathNoAnchor}]]
            </span>
          </figcaption>
        </figure>
      );
    }

    // 2. Audio Embed (.mp3, .wav, .ogg, .m4a, .flac)
    if (AUDIO_EXT_RE.test(targetPathNoAnchor)) {
      const { primarySrc, fallbackSrc } = resolveColonyAssetSources(targetPathNoAnchor);
      return (
        <div
          key={keyPrefix}
          style={{
            margin: '16px 0',
            padding: '12px 16px',
            borderRadius: 14,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600 }}>
            <Music size={14} color="var(--hypha-link)" />
            <span>{caption || targetPathNoAnchor}</span>
          </div>
          <audio controls preload="metadata" style={{ width: '100%' }}>
            <source src={primarySrc} />
            <source src={fallbackSrc} />
          </audio>
        </div>
      );
    }

    // 3. Video Embed (.mp4, .webm, .mov)
    if (VIDEO_EXT_RE.test(targetPathNoAnchor)) {
      const { primarySrc, fallbackSrc } = resolveColonyAssetSources(targetPathNoAnchor);
      return (
        <figure
          key={keyPrefix}
          style={{
            margin: '18px 0',
            padding: 12,
            borderRadius: 16,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            maxWidth: widthPx ? `${widthPx}px` : '100%',
          }}
        >
          <video
            controls
            preload="metadata"
            style={{ width: '100%', borderRadius: 12, display: 'block' }}
          >
            <source src={primarySrc} />
            <source src={fallbackSrc} />
          </video>
          <figcaption style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Film size={13} color="var(--hypha-link)" /> {caption || targetPathNoAnchor}
          </figcaption>
        </figure>
      );
    }

    // 4. PDF Embed (.pdf or .pdf#page=N)
    if (PDF_EXT_RE.test(targetRaw)) {
      const { primarySrc } = resolveColonyAssetSources(targetPathNoAnchor);
      const anchor = targetRaw.includes('#') ? `#${targetRaw.split('#')[1]}` : '';
      return (
        <div
          key={keyPrefix}
          style={{
            margin: '18px 0',
            borderRadius: 16,
            overflow: 'hidden',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-panel)',
          }}
        >
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              <FileText size={13} color="var(--ai-amber)" /> {caption || targetRaw}
            </span>
            <a
              href={`${primarySrc}${anchor}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--hypha-link)', fontSize: 11.5, textDecoration: 'none' }}
            >
              Open PDF ↗
            </a>
          </div>
          <iframe
            src={`${primarySrc}${anchor}`}
            title={caption || targetRaw}
            style={{ width: '100%', height: 420, border: 'none' }}
          />
        </div>
      );
    }

    // 5. Embedded Colony Node (Node / Section / ^block-id Transclusion ![[Target Node#Heading]] or ![[Note#^id]])
    const sectionHeading = targetRaw.includes('#')
      ? targetRaw.split('#').slice(1).join('#').trim()
      : '';
    const effectiveEmbedTarget = targetPathNoAnchor || note.title;
    const stemFallback = effectiveEmbedTarget.split('/').pop() || effectiveEmbedTarget;
    const embeddedNote =
      entityCatalog.byExactSlug.get(normalizeId(effectiveEmbedTarget)) ||
      entityCatalog.byExactSlug.get(normalizeId(stemFallback)) ||
      (entityCatalog.byTermMulti.get(normalizeId(effectiveEmbedTarget)) || [])[0] ||
      (entityCatalog.byTermMulti.get(normalizeId(stemFallback)) || [])[0];

    if (embeddedNote && (embeddedNote.id !== note.id || Boolean(sectionHeading))) {
      const rawSourceBody = sectionHeading
        ? extractNoteSectionOrBlock(embeddedNote.body, sectionHeading) ||
          extractMarkdownSection(embeddedNote.body, sectionHeading) ||
          stripLeadingTitleHeading(embeddedNote.body, embeddedNote.title)
        : stripLeadingTitleHeading(embeddedNote.body, embeddedNote.title);

      const isBlockRef = sectionHeading.startsWith('^');
      return (
        <div
          key={keyPrefix}
          style={{
            margin: '18px 0',
            padding: '14px 18px',
            borderRadius: 16,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-strong)',
            borderLeft: '4px solid var(--hypha-link)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <BookOpen size={14} color="var(--hypha-link)" />
              <span style={{ fontWeight: 700, fontSize: 14 }}>
                {caption ||
                  (sectionHeading
                    ? `${embeddedNote.title} ${isBlockRef ? sectionHeading : `§ ${sectionHeading}`}`
                    : embeddedNote.title)}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-muted)',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                ![[{embeddedNote.title}
                {sectionHeading ? `#${sectionHeading}` : ''}]]
              </span>
            </div>
            <button
              type="button"
              className="btn-subtle"
              style={{ padding: '3px 10px', fontSize: 11.5, color: 'var(--hypha-link)' }}
              onClick={() => {
                onNavigateToNote(embeddedNote.id, false);
                if (sectionHeading) {
                  setTimeout(() => {
                    const targetDomId = isBlockRef
                      ? `block-${sectionHeading.slice(1)}`
                      : `section-${normalizeId(sectionHeading)}`;
                    document
                      .getElementById(targetDomId)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 120);
                }
              }}
            >
              Open {isBlockRef ? 'Block' : sectionHeading ? 'Section' : 'Node'} →
            </button>
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.75 }}>
            {renderMarkdownFragment(rawSourceBody, false, 1)}
          </div>
        </div>
      );
    }

    return null;
  };

  const renderStandardMarkdownMedia = (
    altRaw: string,
    urlRaw: string,
    keyPrefix: string
  ): React.ReactNode => {
    const altParts = altRaw.split('|').map((s) => s.trim());
    const altText = altParts[0] || 'Embedded Media';
    const { widthPx } = parseEmbedOptions(altParts.slice(1));

    const ytEmbed = extractYoutubeEmbedUrl(urlRaw);
    if (ytEmbed) {
      return (
        <figure
          key={keyPrefix}
          style={{
            margin: '18px 0',
            padding: 12,
            borderRadius: 16,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 12 }}>
            <iframe
              src={ytEmbed}
              title={altText}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
            />
          </div>
          <figcaption style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            <Film size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {altText}
          </figcaption>
        </figure>
      );
    }

    const { primarySrc, fallbackSrc } = resolveColonyAssetSources(urlRaw);
    return (
      <figure
        key={keyPrefix}
        style={{
          margin: '18px 0',
          padding: 12,
          borderRadius: 16,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-subtle)',
          maxWidth: widthPx ? `${widthPx}px` : '100%',
        }}
      >
        <img
          src={primarySrc}
          alt={altText}
          style={{ width: '100%', height: 'auto', borderRadius: 12, display: 'block', cursor: 'zoom-in' }}
          onClick={() => setLightboxMedia({ src: primarySrc, caption: altText })}
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.dataset.retried) {
              img.dataset.retried = '1';
              img.src = fallbackSrc;
            }
          }}
        />
        {altText && (
          <figcaption style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            {altText}
          </figcaption>
        )}
      </figure>
    );
  };

  const renderRichInline = (
    rawLineText: string,
    inlineSegCounterRef: { current: number }
  ): React.ReactNode[] => {
    const lineText = normalizeFormattedLinks(stripDelimitedComments(rawLineText));
    const tokenRe =
      /(!?\[\[[^\[\]]+\]\])|(!\[[^\]]*\]\([^)]+\))|(==\[AI(?::([^\]]+))?\]\s*(.+?)==)|(==([^=]+)==)|(\$\$[^$]+\$\$|\$[^$\n]+\$)|(\[\^([^\]]+)\])|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(`[^`\n]+`)|(\[([^\]]+)\]\(([^)]+)\))|((?:^|\s)#[a-zA-Z0-9_\-\u0E00-\u0E7F/]+)/g;
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyCounter = 0;

    const renderPlainWithAutoEntities = (plain: string): React.ReactNode[] => {
      if (!plain) return [];
      for (const { term, candidates } of entityCatalog.detectableTerms) {
        const idx = plain.indexOf(term);
        if (idx !== -1) {
          const before = plain.slice(0, idx);
          const after = plain.slice(idx + term.length);
          const isAmbiguous = candidates.length > 1;
          return [
            ...renderPlainWithAutoEntities(before),
            <span
              key={`ent-${keyCounter++}-${term}`}
              className="detected-entity"
              title={
                isAmbiguous
                  ? `Ambiguous term "${term}" matches ${candidates.length} Nodes — click to choose which Node to link`
                  : `Detected Colony Node "${candidates[0].title}" — click to preview or connect [[Hypha]]`
              }
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                setHoverPreview({
                  candidates,
                  stubTitle: null,
                  matchedTerm: term,
                  isUnlinkedEntity: true,
                  x: Math.min(window.innerWidth - 360, rect.left),
                  y: rect.bottom + 8,
                });
              }}
            >
              {term}
              {isAmbiguous && (
                <sup
                  style={{
                    fontSize: 9.5,
                    color: 'var(--hypha-link)',
                    fontWeight: 700,
                    marginLeft: 2,
                  }}
                >
                  [{candidates.length}]
                </sup>
              )}
            </span>,
            ...renderPlainWithAutoEntities(after),
          ];
        }
      }
      return [plain];
    };

    while ((match = tokenRe.exec(lineText)) !== null) {
      if (match.index > lastIndex) {
        nodes.push(...renderPlainWithAutoEntities(lineText.slice(lastIndex, match.index)));
      }

      if (match[1]) {
        const rawLink = match[1];
        const isEmbed = rawLink.startsWith('!');
        const inner = rawLink.replace(/^!?\[\[|\]\]$/g, '');

        if (isEmbed) {
          const embedEl = renderEmbed(inner, `emb-${keyCounter++}`);
          if (embedEl) {
            nodes.push(embedEl);
            lastIndex = match.index + match[0].length;
            continue;
          }
        }

        const [targetAndHeading, alias] = inner.split('|').map((s) => s.trim());
        const [targetTitle, headingAnchor] = targetAndHeading.split('#').map((s) => s.trim());
        const isBlockRef = Boolean(headingAnchor && headingAnchor.startsWith('^'));
        const display =
          alias ||
          (headingAnchor
            ? targetTitle
              ? `${targetTitle} ${isBlockRef ? headingAnchor : `§ ${headingAnchor}`}`
              : isBlockRef
              ? headingAnchor
              : `§ ${headingAnchor}`
            : targetTitle);

        const effectiveTargetTitle = targetTitle || note.title;
        const stemFallback = effectiveTargetTitle.split('/').pop() || effectiveTargetTitle;
        const exactMatch =
          entityCatalog.byExactSlug.get(normalizeId(effectiveTargetTitle)) ||
          entityCatalog.byExactSlug.get(normalizeId(stemFallback));
        const multiCandidates =
          entityCatalog.byTermMulti.get(normalizeId(effectiveTargetTitle)) ||
          entityCatalog.byTermMulti.get(normalizeId(stemFallback)) ||
          [];
        const resolvedCandidates = exactMatch
          ? [
              exactMatch,
              ...multiCandidates.filter((c) => c.id !== exactMatch.id),
            ]
          : multiCandidates;

        nodes.push(
          <a
            key={`wl-${keyCounter++}`}
            className={`hypha-link ${resolvedCandidates.length > 0 ? '' : 'stub'}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const scrollAfterNav = () => {
                if (headingAnchor) {
                  setTimeout(() => {
                    const domId = isBlockRef
                      ? `block-${headingAnchor.slice(1)}`
                      : `section-${normalizeId(headingAnchor)}`;
                    document
                      .getElementById(domId)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 100);
                }
              };
              if (resolvedCandidates.length === 1) {
                onNavigateToNote(resolvedCandidates[0].id, false);
                scrollAfterNav();
              } else if (resolvedCandidates.length > 1 && !exactMatch) {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoverPreview({
                  candidates: resolvedCandidates,
                  stubTitle: null,
                  matchedTerm: display,
                  isUnlinkedEntity: false,
                  x: Math.min(window.innerWidth - 360, rect.left),
                  y: rect.bottom + 8,
                });
              } else if (exactMatch) {
                onNavigateToNote(exactMatch.id, false);
                scrollAfterNav();
              } else {
                // Missing Node (Red Stub Link): show compact, non-annoying "Node is unavailable" pill
                const rect = e.currentTarget.getBoundingClientRect();
                setHoverPreview(null);
                setStubUnavailablePill({
                  title: effectiveTargetTitle,
                  x: Math.min(window.innerWidth - 260, Math.max(16, rect.left)),
                  y: Math.max(56, rect.top - 8),
                });
              }
            }}
            onMouseEnter={(e) => {
              // Do not show big hover card on red unavailable stub links
              if (resolvedCandidates.length === 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              setHoverPreview({
                candidates: resolvedCandidates,
                stubTitle: null,
                x: Math.min(window.innerWidth - 360, rect.left),
                y: rect.bottom + 8,
              });
            }}
          >
            {isEmbed ? `📄 ${display}` : display}
          </a>
        );
      } else if (match[2]) {
        const mdImg = match[2];
        const m = mdImg.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (m) {
          nodes.push(renderStandardMarkdownMedia(m[1], m[2], `mdm-${keyCounter++}`));
        }
      } else if (match[3]) {
        const rawFullMatch = match[3];
        const sourceHint = match[4] || 'AI';
        const aiText = match[5];
        const segIndex = inlineSegCounterRef.current++;
        const matchingSeg =
          note.ai_segments.find((s) => s.kind === 'inline' && s.content === aiText.trim()) ||
          note.ai_segments[segIndex];

        nodes.push(
          <span key={`ai-in-${keyCounter++}`} className="ai-inline-highlight">
            <span className="ai-inline-badge">[{sourceHint}]</span>
            <span>{renderRichInline(aiText, inlineSegCounterRef)}</span>
            {matchingSeg && (
              <button
                type="button"
                className="verify-pill-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onVerifySegment(matchingSeg.id);
                }}
                title="Verified — click to approve and promote to verified prose"
              >
                <CheckCircle2 size={11} /> Verify
              </button>
            )}
            <button
              type="button"
              className="verify-pill-btn"
              style={{
                padding: '2px 7px',
                borderColor: 'var(--border-strong)',
                color: 'var(--text-secondary)',
              }}
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveAiFlag(rawFullMatch, aiText);
              }}
              title="Remove AI Flag (Unmark as AI)"
            >
              <X size={10} /> Unmark AI
            </button>
          </span>
        );
      } else if (match[6]) {
        // Standard Highlight ==highlighted text== (supports nested **[[Hypha]]** inside!)
        const hlText = match[7];
        nodes.push(
          <mark
            key={`hl-${keyCounter++}`}
            style={{
              background: 'rgba(16, 185, 129, 0.18)',
              color: 'inherit',
              padding: '1px 6px',
              borderRadius: 6,
              borderBottom: '1.5px solid var(--verified-emerald)',
            }}
          >
            {renderRichInline(hlText, inlineSegCounterRef)}
          </mark>
        );
      } else if (match[8]) {
        // Inline or Display Math $...$ or $$...$$
        const rawMath = match[8].replace(/^\$+|\$+$/g, '');
        nodes.push(
          <span
            key={`math-${keyCounter++}`}
            style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontStyle: 'italic',
              fontSize: '1.08em',
              padding: '1px 7px',
              borderRadius: 6,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--hypha-link)',
            }}
            title={`LaTeX Math: ${rawMath}`}
          >
            {formatLatexMath(rawMath)}
          </span>
        );
      } else if (match[9]) {
        // Footnote Reference [^1]
        const fnId = match[10];
        nodes.push(
          <sup key={`fn-${keyCounter++}`} style={{ marginLeft: 2 }}>
            <a
              href={`#fn-${fnId}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                document
                  .getElementById(`fn-${fnId}`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              style={{
                color: 'var(--hypha-link)',
                fontWeight: 700,
                textDecoration: 'none',
                fontSize: 11,
                padding: '0 3px',
              }}
            >
              [{fnId}]
            </a>
          </sup>
        );
      } else if (match[11]) {
        // Bold **...** — recursively renders **[[Hypha]]** as a bold Hypha link!
        const boldText = match[11].slice(2, -2);
        nodes.push(
          <strong key={`b-${keyCounter++}`} style={{ fontWeight: 700 }}>
            {renderRichInline(boldText, inlineSegCounterRef)}
          </strong>
        );
      } else if (match[12]) {
        // Italic *...* — recursively renders *[[Hypha]]* as an italic Hypha link!
        const italicText = match[12].slice(1, -1);
        nodes.push(
          <em key={`i-${keyCounter++}`}>
            {renderRichInline(italicText, inlineSegCounterRef)}
          </em>
        );
      } else if (match[13]) {
        const strikeText = match[13].slice(2, -2);
        nodes.push(
          <del key={`s-${keyCounter++}`} style={{ color: 'var(--text-muted)' }}>
            {renderRichInline(strikeText, inlineSegCounterRef)}
          </del>
        );
      } else if (match[14]) {
        const codeText = match[14].slice(1, -1);
        nodes.push(
          <code
            key={`c-${keyCounter++}`}
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: '0.88em',
              padding: '2px 6px',
              borderRadius: 6,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {codeText}
          </code>
        );
      } else if (match[15]) {
        // Standard Markdown Link [text](url or relative .md)
        const linkLabel = match[16];
        const linkHref = match[17].trim();
        const isExternal = /^(https?:\/\/|mailto:)/i.test(linkHref);
        if (isExternal) {
          nodes.push(
            <a
              key={`mdl-${keyCounter++}`}
              href={linkHref}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                color: 'var(--hypha-link)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span>{renderRichInline(linkLabel, inlineSegCounterRef)}</span>
              <ExternalLink size={11} />
            </a>
          );
        } else {
          const decodedTarget = decodeURIComponent(linkHref).replace(/\.md$/i, '');
          nodes.push(
            <a
              key={`mdl-${keyCounter++}`}
              href={linkHref}
              className="hypha-link"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNavigateToNote(decodedTarget, false);
              }}
            >
              {renderRichInline(linkLabel, inlineSegCounterRef)}
            </a>
          );
        }
      } else if (match[18]) {
        // Inline #tag / #cluster/subcluster pill
        const fullTagMatch = match[18];
        const leadingSpace = fullTagMatch.startsWith(' ') ? ' ' : '';
        const cleanTag = fullTagMatch.trim().replace(/^#/, '');
        if (leadingSpace) {
          nodes.push(' ');
        }
        nodes.push(
          <button
            key={`tag-${keyCounter++}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectCluster?.(cleanTag);
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '1px 8px',
              borderRadius: 999,
              fontSize: '0.84em',
              fontFamily: '"JetBrains Mono", monospace',
              background: 'var(--hypha-link-bg)',
              color: 'var(--hypha-link)',
              border: '1px solid var(--border-subtle)',
              cursor: 'pointer',
              verticalAlign: 'baseline',
            }}
            title={`Filter Colony by Cluster #${cleanTag}`}
          >
            #{cleanTag}
          </button>
        );
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < lineText.length) {
      nodes.push(...renderPlainWithAutoEntities(lineText.slice(lastIndex)));
    }

    return nodes;
  };

  function renderMarkdownFragment(
    markdownSource: string,
    enableHeadingFold = true,
    transclusionDepth = 0
  ): React.ReactNode[] {
    if (transclusionDepth > 2) return [];
    const lines = stripDelimitedComments(markdownSource).split(/\r?\n/);
    const blocks: React.ReactNode[] = [];
    const footnotes: Array<{ id: string; text: string }> = [];
    const inlineSegCounterRef = { current: 0 };
    const aiCalloutHeaderRe = /^>\s*\[!(ai|ai-draft|ai-unverified)\]([+-])?\s*(.*)$/i;
    const stdCalloutHeaderRe = /^>\s*\[!([a-zA-Z0-9_-]+)\]([+-])?\s*(.*)$/;
    const footnoteDefRe = /^\[\^([^\]]+)\]:\s*(.+)$/;
    const hrRe = /^(\*{3,}|-{3,}|_{3,})$/;

    let i = 0;
    let activeFoldedLevel: number | null = null;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // Check if we hit a heading that ends or starts a fold
      const hCheck = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (hCheck && enableHeadingFold) {
        const lvl = hCheck[1].length;
        if (activeFoldedLevel !== null && lvl <= activeFoldedLevel) {
          activeFoldedLevel = null;
        }
      }

      if (activeFoldedLevel !== null) {
        i++;
        continue;
      }

      // Horizontal Rule (--- / *** / ___)
      if (hrRe.test(trimmed)) {
        blocks.push(
          <hr
            key={`hr-${i}`}
            style={{
              border: 'none',
              borderTop: '1px solid var(--border-subtle)',
              margin: '22px 0',
            }}
          />
        );
        i++;
        continue;
      }

      // Footnote definition [^1]: text
      const fnDefMatch = trimmed.match(footnoteDefRe);
      if (fnDefMatch) {
        footnotes.push({ id: fnDefMatch[1], text: fnDefMatch[2] });
        i++;
        continue;
      }

      // 0. Display Math Block $$ ... $$
      if (trimmed.startsWith('$$')) {
        const mathLines: string[] = [];
        if (trimmed.endsWith('$$') && trimmed.length > 4) {
          mathLines.push(trimmed.slice(2, -2));
          i++;
        } else {
          i++;
          while (i < lines.length && !lines[i].trim().startsWith('$$')) {
            mathLines.push(lines[i]);
            i++;
          }
          if (i < lines.length) i++;
        }
        const mathRaw = mathLines.join('\n').trim();
        blocks.push(
          <div
            key={`math-blk-${i}`}
            style={{
              margin: '18px 0',
              padding: '16px 20px',
              borderRadius: 14,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              textAlign: 'center',
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontStyle: 'italic',
              fontSize: 21,
              color: 'var(--hypha-link)',
            }}
            title={`LaTeX Display Math: ${mathRaw}`}
          >
            {formatLatexMath(mathRaw)}
          </div>
        );
        continue;
      }

      // 1. Fenced Code Blocks & Mermaid Diagrams (```mermaid or ```lang)
      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim().toLowerCase();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing ```
        const codeContent = codeLines.join('\n');

        if (lang === 'mermaid') {
          blocks.push(
            <MermaidDiagramBlock
              key={`mermaid-${i}`}
              code={codeContent}
              onNavigateToNote={(t) => onNavigateToNote(t, false)}
            />
          );
        } else {
          blocks.push(
            <div
              key={`code-${i}`}
              style={{
                margin: '18px 0',
                borderRadius: 14,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Code2 size={12} /> {lang || 'markdown'}
                </span>
                <button
                  type="button"
                  className="btn-subtle"
                  style={{ padding: '2px 8px', fontSize: 10.5 }}
                  onClick={() => navigator.clipboard?.writeText(codeContent)}
                >
                  Copy
                </button>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '14px 16px',
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 12.5,
                  lineHeight: 1.65,
                  overflowX: 'auto',
                }}
              >
                {codeContent}
              </pre>
            </div>
          );
        }
        continue;
      }

      // 2. Standalone Media / Note Transclusion Line: ![[...]]
      const standaloneEmbedMatch = trimmed.match(/^!\[\[([^\[\]]+)\]\]$/);
      if (standaloneEmbedMatch) {
        const el = renderEmbed(standaloneEmbedMatch[1], `block-emb-${i}`);
        if (el) {
          blocks.push(el);
          i++;
          continue;
        }
      }

      // 3. Standalone Standard Markdown Image / Video Line: ![alt](url)
      const standaloneMdMedia = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (standaloneMdMedia) {
        blocks.push(
          renderStandardMarkdownMedia(
            standaloneMdMedia[1],
            standaloneMdMedia[2],
            `block-mdm-${i}`
          )
        );
        i++;
        continue;
      }

      // 4. Epistemic AI Callout (> [!ai]) — Supports Folding
      const calloutMatch = trimmed.match(aiCalloutHeaderRe);
      if (calloutMatch) {
        const foldModifier = calloutMatch[2];
        const titleHint = calloutMatch[3]?.trim() || 'AI Generated Content (Unverified)';
        const calloutKey = `ai-callout-${i}`;
        const isFolded = foldedCallouts[calloutKey] ?? foldModifier === '-';
        const contentLines: string[] = [];
        i++;
        while (i < lines.length && lines[i].trimStart().startsWith('>')) {
          contentLines.push(lines[i].trimStart().replace(/^>\s?/, ''));
          i++;
        }
        const joinedContent = contentLines.join('\n').trim();
        const matchingSeg = note.ai_segments.find(
          (s) => s.kind === 'callout' && s.content === joinedContent
        );

        blocks.push(
          <div key={calloutKey} className="ai-callout-block">
            <div
              className="ai-callout-header"
              style={{ cursor: 'pointer' }}
              onClick={() =>
                setFoldedCallouts((prev) => ({ ...prev, [calloutKey]: !isFolded }))
              }
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {isFolded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <Sparkles size={14} /> {titleHint}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {matchingSeg && (
                  <button
                    type="button"
                    className="verify-pill-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onVerifySegment(matchingSeg.id);
                    }}
                  >
                    <CheckCircle2 size={12} /> Approve & Verify Block
                  </button>
                )}
                {matchingSeg && (
                  <button
                    type="button"
                    className="verify-pill-btn"
                    style={{
                      borderColor: 'var(--border-strong)',
                      color: 'var(--text-secondary)',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveAiFlag(matchingSeg.raw_match, joinedContent);
                    }}
                    title="Remove AI Flag from this block"
                  >
                    <X size={11} /> Unmark AI
                  </button>
                )}
              </span>
            </div>
            {!isFolded && (
              <div style={{ lineHeight: 1.8 }}>
                {renderRichInline(joinedContent, inlineSegCounterRef)}
              </div>
            )}
          </div>
        );
        continue;
      }

      // 5. Standard Callout (> [!info]+, > [!tip]-, > [!warning], etc.)
      const stdCalloutMatch = trimmed.match(stdCalloutHeaderRe);
      if (stdCalloutMatch) {
        const kind = stdCalloutMatch[1].toLowerCase();
        const foldModifier = stdCalloutMatch[2];
        const titleHint =
          stdCalloutMatch[3]?.trim() || kind.charAt(0).toUpperCase() + kind.slice(1);
        const calloutKey = `std-callout-${i}`;
        const isFolded = foldedCallouts[calloutKey] ?? foldModifier === '-';
        const contentLines: string[] = [];
        i++;
        while (i < lines.length && lines[i].trimStart().startsWith('>')) {
          contentLines.push(lines[i].trimStart().replace(/^>\s?/, ''));
          i++;
        }
        const joinedContent = contentLines.join('\n').trim();
        const accentColor =
          kind === 'warning' || kind === 'caution'
            ? 'var(--ai-amber)'
            : kind === 'tip' || kind === 'success'
            ? 'var(--verified-emerald)'
            : 'var(--hypha-link)';

        blocks.push(
          <div
            key={calloutKey}
            style={{
              margin: '18px 0',
              padding: '14px 18px',
              borderRadius: 16,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              borderLeft: `4px solid ${accentColor}`,
            }}
          >
            <div
              onClick={() =>
                setFoldedCallouts((prev) => ({ ...prev, [calloutKey]: !isFolded }))
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 700,
                fontSize: 13,
                color: accentColor,
                marginBottom: isFolded ? 0 : 6,
                cursor: 'pointer',
              }}
            >
              {isFolded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <Info size={14} /> {titleHint}
            </div>
            {!isFolded && (
              <div style={{ lineHeight: 1.78 }}>
                {renderRichInline(joinedContent, inlineSegCounterRef)}
              </div>
            )}
          </div>
        );
        continue;
      }

      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trimStart().startsWith('>')) {
          quoteLines.push(lines[i].trimStart().replace(/^>\s?/, ''));
          i++;
        }
        blocks.push(
          <blockquote
            key={`quote-${i}`}
            style={{
              margin: '16px 0',
              padding: '10px 16px',
              borderLeft: '3px solid var(--hypha-link)',
              background: 'var(--bg-panel)',
              borderRadius: '0 12px 12px 0',
              color: 'var(--text-secondary)',
              lineHeight: 1.78,
            }}
          >
            {renderRichInline(quoteLines.join(' '), inlineSegCounterRef)}
          </blockquote>
        );
        continue;
      }

      // 6. Markdown Tables (| Col 1 | Col 2 |)
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i].trim());
          i++;
        }
        if (tableLines.length >= 2) {
          const parseRow = (r: string) =>
            r
              .replace(/^\||\|$/g, '')
              .split('|')
              .map((c) => c.trim());
          const headers = parseRow(tableLines[0]);
          const dataRows = tableLines
            .slice(1)
            .filter((r) => !/^\|?[\s:-]+\|/.test(r))
            .map(parseRow);

          blocks.push(
            <div
              key={`tbl-${i}`}
              style={{
                margin: '20px 0',
                overflowX: 'auto',
                borderRadius: 14,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 13.5,
                }}
              >
                <thead>
                  <tr style={{ background: 'var(--bg-panel)' }}>
                    {headers.map((h, hIdx) => (
                      <th
                        key={hIdx}
                        style={{
                          textAlign: 'left',
                          padding: '10px 14px',
                          borderBottom: '1px solid var(--border-strong)',
                          fontWeight: 700,
                        }}
                      >
                        {renderRichInline(h, inlineSegCounterRef)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      style={{
                        borderBottom:
                          rIdx < dataRows.length - 1
                            ? '1px solid var(--border-subtle)'
                            : 'none',
                      }}
                    >
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} style={{ padding: '10px 14px', lineHeight: 1.65 }}>
                          {renderRichInline(cell, inlineSegCounterRef)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          continue;
        }
      }

      // 7. Collapsible Headings with Section Anchor IDs (#section-slug)
      const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        const text = hMatch[2];
        if (level === 1 && text.trim() === note.title.trim()) {
          i++;
          continue;
        }
        const slug = normalizeId(text);
        const isHeadingFolded = Boolean(foldedHeadings[slug]);
        if (isHeadingFolded && enableHeadingFold) {
          activeFoldedLevel = level;
        }
        const TagName = (`h${level}` as unknown) as keyof React.JSX.IntrinsicElements;
        blocks.push(
          <TagName
            id={`section-${slug}`}
            key={`h-${i}`}
            style={{
              fontFamily:
                level <= 2
                  ? '"Instrument Serif", "Noto Sans Thai", Georgia, serif'
                  : 'inherit',
              fontSize: level === 1 ? 30 : level === 2 ? 24 : 18,
              fontWeight: 600,
              marginTop: enableHeadingFold ? 28 : 10,
              marginBottom: enableHeadingFold ? 12 : 6,
              paddingBottom: level === 2 ? 8 : 0,
              borderBottom: level === 2 ? '1px solid var(--border-subtle)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {enableHeadingFold && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFoldedHeadings((prev) => ({ ...prev, [slug]: !isHeadingFolded }));
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
                title={isHeadingFolded ? 'Unfold section' : 'Fold section'}
              >
                {isHeadingFolded ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            )}
            <span>{renderRichInline(text, inlineSegCounterRef)}</span>
            {isHeadingFolded && (
              <span
                style={{
                  fontSize: 11,
                  fontFamily: '"JetBrains Mono", monospace',
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'var(--bg-panel)',
                  color: 'var(--text-muted)',
                }}
              >
                folded
              </span>
            )}
          </TagName>
        );
        i++;
        continue;
      }

      // 8. Ordered (<ol>) & Unordered (<ul>) Lists with Nested Indentation & Interactive Checkboxes (- [ ] / - [x])
      if (/^([-*+]|\d+\.)\s+/.test(trimmed)) {
        const isFirstOrdered = /^\d+\.\s+/.test(trimmed);
        const listItems: Array<{ rawText: string; indentLevel: number; isOrdered: boolean }> = [];
        while (i < lines.length && /^([-*+]|\d+\.)\s+/.test(lines[i].trim())) {
          const rawLine = lines[i];
          const leadingSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '  ').length;
          const indentLevel = Math.min(4, Math.floor(leadingSpaces / 2));
          const itemTrimmed = rawLine.trim();
          const itemOrdered = /^\d+\.\s+/.test(itemTrimmed);
          listItems.push({
            rawText: itemTrimmed.replace(/^([-*+]|\d+\.)\s+/, ''),
            indentLevel,
            isOrdered: itemOrdered,
          });
          i++;
        }
        const ListTag = isFirstOrdered ? 'ol' : 'ul';
        blocks.push(
          <ListTag
            key={`list-${i}`}
            style={{
              paddingLeft: 24,
              margin: enableHeadingFold ? '14px 0' : '6px 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {listItems.map(({ rawText, indentLevel, isOrdered }, idx) => {
              const blockIdMatch = rawText.match(/\s+\^([a-zA-Z0-9_-]+)\s*$/);
              const blockId = blockIdMatch ? blockIdMatch[1] : null;
              const item = blockIdMatch
                ? rawText.slice(0, blockIdMatch.index).trimEnd()
                : rawText;

              const taskMatch = item.match(/^\[([ xX])\]\s+(.+)$/);
              if (taskMatch) {
                const checked = taskMatch[1].toLowerCase() === 'x';
                const taskLabel = taskMatch[2];
                return (
                  <li
                    key={idx}
                    id={blockId ? `block-${blockId}` : undefined}
                    style={{
                      lineHeight: 1.78,
                      listStyle: 'none',
                      marginLeft: indentLevel * 20 - 18,
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleToggleCheckbox(taskLabel, checked);
                      }}
                      style={{ cursor: 'pointer', accentColor: 'var(--verified-emerald)' }}
                      title="Click to toggle task in .md file (supports Undo)"
                    />
                    <span
                      style={{
                        textDecoration: checked ? 'line-through' : 'none',
                        color: checked ? 'var(--text-muted)' : 'inherit',
                      }}
                    >
                      {renderRichInline(taskLabel, inlineSegCounterRef)}
                    </span>
                    {blockId && (
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: '"JetBrains Mono", monospace',
                          color: 'var(--text-muted)',
                          opacity: 0.7,
                          userSelect: 'none',
                        }}
                      >
                        ^{blockId}
                      </span>
                    )}
                  </li>
                );
              }
              return (
                <li
                  key={idx}
                  id={blockId ? `block-${blockId}` : undefined}
                  style={{
                    lineHeight: 1.78,
                    marginLeft: indentLevel * 20,
                    listStyleType: isOrdered ? 'decimal' : indentLevel > 0 ? 'circle' : 'disc',
                  }}
                >
                  {renderRichInline(item, inlineSegCounterRef)}
                  {blockId && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 10,
                        fontFamily: '"JetBrains Mono", monospace',
                        color: 'var(--text-muted)',
                        opacity: 0.7,
                        userSelect: 'none',
                      }}
                    >
                      ^{blockId}
                    </span>
                  )}
                </li>
              );
            })}
          </ListTag>
        );
        continue;
      }

      const paraBlockMatch = trimmed.match(/\s+\^([a-zA-Z0-9_-]+)\s*$/);
      const paraBlockId = paraBlockMatch ? paraBlockMatch[1] : null;
      const paraText = paraBlockMatch
        ? trimmed.slice(0, paraBlockMatch.index).trimEnd()
        : trimmed;

      blocks.push(
        <p
          key={`p-${i}`}
          id={paraBlockId ? `block-${paraBlockId}` : undefined}
          style={{
            margin: enableHeadingFold ? '16px 0' : '4px 0',
            lineHeight: 1.84,
            maxWidth: '68ch',
          }}
        >
          {renderRichInline(paraText, inlineSegCounterRef)}
          {paraBlockId && (
            <span
              style={{
                marginLeft: 6,
                fontSize: 10,
                fontFamily: '"JetBrains Mono", monospace',
                color: 'var(--text-muted)',
                opacity: 0.7,
                userSelect: 'none',
              }}
              title={`Block ID: ^${paraBlockId}`}
            >
              ^{paraBlockId}
            </span>
          )}
        </p>
      );
      i++;
    }

    if (footnotes.length > 0) {
      blocks.push(
        <div
          key="footnotes-section"
          onMouseUp={(e) => e.stopPropagation()}
          style={{
            marginTop: 32,
            paddingTop: 16,
            borderTop: '1px dashed var(--border-subtle)',
            fontSize: 12.5,
            color: 'var(--text-secondary)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-muted)',
              marginBottom: 8,
            }}
          >
            Footnotes
          </div>
          {footnotes.map((fn) => (
            <div
              key={fn.id}
              id={`fn-${fn.id}`}
              style={{ display: 'flex', gap: 8, marginBottom: 6, lineHeight: 1.6 }}
            >
              <strong style={{ color: 'var(--hypha-link)', fontFamily: 'monospace' }}>
                [{fn.id}]
              </strong>
              <span>{renderRichInline(fn.text, inlineSegCounterRef)}</span>
            </div>
          ))}
        </div>
      );
    }

    return blocks;
  };

  const renderedBlocks = useMemo(
    () => renderMarkdownFragment(note.body, true),
    [note, entityCatalog, foldedHeadings, foldedCallouts]
  );

  // Split editBody into logical lines/blocks for Line-by-Line Live Preview!
  const livePreviewLines = useMemo(() => {
    const rawLines = editBody.split(/\r?\n/);
    const chunks: string[] = [];
    let i = 0;
    while (i < rawLines.length) {
      const trimmed = rawLines[i].trim();
      // Keep fenced code / mermaid blocks together as one editable block
      if (trimmed.startsWith('```')) {
        const buf = [rawLines[i]];
        i++;
        while (i < rawLines.length && !rawLines[i].trim().startsWith('```')) {
          buf.push(rawLines[i]);
          i++;
        }
        if (i < rawLines.length) {
          buf.push(rawLines[i]);
          i++;
        }
        chunks.push(buf.join('\n'));
        continue;
      }
      // Keep multi-line callouts (> [!...] + > ...) together
      if (trimmed.startsWith('>')) {
        const buf = [rawLines[i]];
        i++;
        while (i < rawLines.length && rawLines[i].trimStart().startsWith('>')) {
          buf.push(rawLines[i]);
          i++;
        }
        chunks.push(buf.join('\n'));
        continue;
      }
      // Keep contiguous markdown table rows together
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const buf = [rawLines[i]];
        i++;
        while (i < rawLines.length && rawLines[i].trim().startsWith('|')) {
          buf.push(rawLines[i]);
          i++;
        }
        chunks.push(buf.join('\n'));
        continue;
      }
      chunks.push(rawLines[i]);
      i++;
    }
    return chunks.length > 0 ? chunks : [''];
  }, [editBody]);

  const updateLiveLineAt = (idx: number, newText: string) => {
    const copy = [...livePreviewLines];
    copy[idx] = normalizeFormattedLinks(newText);
    pushWriteHistory(copy.join('\n'));
    detectInlineTrigger(newText);
  };

  // Autocomplete options for inline [[Hypha]], #Cluster, or /Slash trigger
  const inlineAutocompleteItems = useMemo(() => {
    if (!inlineTrigger) return [];
    const q = inlineTrigger.query.toLowerCase();
    if (inlineTrigger.kind === 'hypha') {
      const results: Array<{ label: string; insert: string; badge: string }> = [];
      for (const n of allNotes) {
        if (n.id === note.id) continue;
        if (!q || n.title.toLowerCase().includes(q) || n.aliases.some((a) => a.toLowerCase().includes(q))) {
          results.push({
            label: n.title,
            insert: n.title,
            badge: `#${n.tags[0] || 'node'}`,
          });
        }
        // Also match Node#Heading if '#' is in query or query matches heading
        const hMatches = n.body.match(/^#{2,3}\s+(.+)$/gm) || [];
        for (const rawH of hMatches) {
          const hText = rawH.replace(/^#{2,3}\s+/, '').trim();
          const combo = `${n.title}#${hText}`;
          if (q && combo.toLowerCase().includes(q)) {
            results.push({
              label: `${n.title} § ${hText}`,
              insert: combo,
              badge: 'Section #Link',
            });
          }
        }
      }
      return results.slice(0, 7);
    }
    if (inlineTrigger.kind === 'cluster') {
      return colonyClusters
        .filter(([tag]) => !q || tag.toLowerCase().includes(q))
        .slice(0, 8)
        .map(([tag, count]) => ({
          label: `#${tag}`,
          insert: tag,
          badge: `${count} Nodes`,
        }));
    }
    if (inlineTrigger.kind === 'slash') {
      const cmds = [
        { label: '/h2 — Section Heading', insert: '## New Section Heading', badge: 'Heading' },
        { label: '/todo — Interactive Checkbox', insert: '- [ ] Action item to verify', badge: 'Task' },
        { label: '/callout — Info Callout', insert: '> [!info]+ Key Observation\n> Supporting context here.', badge: 'Callout' },
        { label: '/ai — Epistemic AI Callout', insert: '> [!ai] Generated by AI — Pending Verification\n> Draft claim here.', badge: 'Epistemic' },
        { label: '/math — LaTeX Equation Block', insert: '$$\nE = \\sum_{i=1}^{n} w_i x_i + b\n$$', badge: 'LaTeX' },
        { label: '/mermaid — Flowchart Diagram', insert: '```mermaid\ngraph LR\n  Spore --> Hypha --> Mycelium\n```', badge: 'Diagram' },
        { label: '/table — Markdown Table', insert: '| Concept | Role |\n| :--- | :--- |\n| [[Fungi]] | Primary decomposer |', badge: 'Table' },
      ];
      return cmds.filter((c) => !q || c.label.toLowerCase().includes(q));
    }
    return [];
  }, [inlineTrigger, allNotes, note.id, colonyClusters]);

  const isVerified = note.epistemic_status === 'verified' && note.ai_segments.length === 0;

  return (
    <div
      className="node-container"
      onClick={() => {
        setHoverPreview(null);
        setStubUnavailablePill(null);
      }}
    >
      {/* Top Meta Bar & .md File Actions (Single Topbar Read/Write Switcher lives in App header) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11.5,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)',
            }}
          >
            {note.rel_path}
          </span>
          {note.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onSelectCluster?.(tag)}
              className="btn-subtle"
              style={{
                fontSize: 11.5,
                padding: '3px 10px',
              }}
              title={`Filter Colony by Cluster #${tag}`}
            >
              <Tag size={10} /> #{tag}
            </button>
          ))}

          {/* Undo & Redo Buttons (Active in BOTH Read Mode & Write Mode!) */}
          <button
            type="button"
            className="btn-subtle"
            disabled={!canUndo}
            onClick={handleUndo}
            style={{
              fontSize: 11,
              padding: '3px 9px',
              opacity: canUndo ? 1 : 0.42,
              cursor: canUndo ? 'pointer' : 'not-allowed',
              borderColor: canUndo ? 'var(--hypha-link)' : undefined,
            }}
            title="Undo last action (Connect Hypha, Mark/Unmark AI, or Write edit) — Cmd/Ctrl+Z"
          >
            <Undo2 size={11} /> Undo
          </button>

          <button
            type="button"
            className="btn-subtle"
            disabled={!canRedo}
            onClick={handleRedo}
            style={{
              fontSize: 11,
              padding: '3px 9px',
              opacity: canRedo ? 1 : 0.42,
              cursor: canRedo ? 'pointer' : 'not-allowed',
            }}
            title="Redo action — Cmd/Ctrl+Shift+Z"
          >
            <Redo2 size={11} /> Redo
          </button>

          {/* File Actions */}
          <button
            type="button"
            className="btn-subtle"
            style={{ fontSize: 11, padding: '3px 9px' }}
            onClick={() => setShowPropertiesDrawer((v) => !v)}
            title="Toggle Frontmatter Properties Inspector"
          >
            <SlidersHorizontal size={11} /> Properties
          </button>

          <button
            type="button"
            className="btn-subtle"
            style={{ fontSize: 11, padding: '3px 9px' }}
            onClick={handleExportMarkdownFile}
            title={`Download ${note.rel_path} to your computer`}
          >
            <Download size={11} /> .md
          </button>

          {onDuplicateNote && (
            <button
              type="button"
              className="btn-subtle"
              style={{ fontSize: 11, padding: '3px 9px' }}
              onClick={onDuplicateNote}
              title="Duplicate this .md Node inside Colony"
            >
              <Copy size={11} /> Duplicate
            </button>
          )}

          {onDeleteNote && allNotes.length > 1 && (
            <button
              type="button"
              className="btn-subtle"
              style={{
                fontSize: 11,
                padding: '3px 9px',
                color: 'var(--ai-amber)',
                borderColor: confirmDeleteNodeOpen ? 'var(--ai-amber)' : undefined,
              }}
              onClick={() => setConfirmDeleteNodeOpen((v) => !v)}
              title="Delete this .md Node from Colony (opens confirmation)"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>

        {mode === 'write' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isWriteDirty && (
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: 'var(--ai-amber)',
                  padding: '4px 10px',
                  borderRadius: 999,
                  background: 'var(--ai-amber-bg)',
                  border: '1px solid var(--ai-amber)',
                }}
              >
                ● Unsaved Changes
              </span>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleSaveStructured(false)}
              style={{ padding: '6px 14px', fontSize: 12.5 }}
            >
              <CheckCircle2 size={14} /> Save Node
            </button>
          </div>
        )}
      </div>

      {confirmDeleteNodeOpen && onDeleteNote && (
        <div
          style={{
            marginBottom: 14,
            padding: '12px 16px',
            borderRadius: 14,
            background: 'var(--ai-amber-bg)',
            border: '1.5px solid var(--ai-amber)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: 12.5,
          }}
        >
          <span>
            Delete <strong>{note.title}</strong> (<code>{note.rel_path}</code>) from this Colony?
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-subtle"
              onClick={() => setConfirmDeleteNodeOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDeleteNodeOpen(false);
                onDeleteNote();
              }}
              style={{
                padding: '5px 12px',
                borderRadius: 9,
                border: 'none',
                background: '#EF4444',
                color: '#fff',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Confirm Delete Node
            </button>
          </div>
        </div>
      )}

      {statusToast && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--verified-emerald-bg)',
            border: '1px solid var(--verified-emerald)',
            color: 'var(--verified-emerald)',
            fontSize: 12.5,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={15} /> {statusToast}
          </span>
          {canUndo && (
            <button
              type="button"
              onClick={handleUndo}
              className="btn-subtle"
              style={{
                padding: '3px 10px',
                fontSize: 11.5,
                color: 'var(--text-primary)',
                borderColor: 'var(--border-strong)',
              }}
              title="Undo this action immediately"
            >
              <Undo2 size={12} /> Undo
            </button>
          )}
        </div>
      )}

      {/* Unified Rounded Paper Card for BOTH Read Node & Write Node */}
      <div className="node-reading-card">
        {/* Disambiguation & Active Node Scope Hatnote (Scope Hatnote) */}
        {(note.frontmatter.scope || disambiguationSiblings.length > 0) && mode === 'read' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 14,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              marginBottom: 18,
              fontSize: 12.5,
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GitBranch size={14} color="var(--hypha-link)" />
              <span>
                <strong>Current Node Scope:</strong>{' '}
                {note.frontmatter.scope || `Primary article for ${note.title}`}
              </span>
            </div>

            {disambiguationSiblings.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Same term in other Clusters:
                </span>
                {disambiguationSiblings.map((sib) => (
                  <button
                    key={sib.id}
                    type="button"
                    className="btn-subtle"
                    style={{
                      padding: '2px 10px',
                      fontSize: 11.5,
                      color: 'var(--hypha-link)',
                      borderColor: 'var(--hypha-link)',
                    }}
                    onClick={() => onNavigateToNote(sib.id)}
                  >
                    Switch to {sib.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Collapsible Frontmatter Properties Drawer (in Read Mode) */}
        {showPropertiesDrawer && mode === 'read' && (
          <div
            style={{
              marginBottom: 20,
              padding: '14px 16px',
              borderRadius: 16,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-strong)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 12.5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                YAML Properties ({note.rel_path})
              </span>
              <button
                type="button"
                className="btn-subtle"
                style={{ padding: '2px 8px', fontSize: 11 }}
                onClick={() => onModeChange('write')}
              >
                <PenTool size={11} /> Edit Properties
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: 6, columnGap: 12, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>title</span>
              <span style={{ fontWeight: 600 }}>{note.title}</span>

              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>clusters</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {note.tags.map((t) => (
                  <span
                    key={t}
                    onClick={() => onSelectCluster?.(t)}
                    style={{
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      fontSize: 11.5,
                    }}
                  >
                    #{t}
                  </span>
                ))}
              </div>

              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>aliases</span>
              <span>{note.aliases.length > 0 ? note.aliases.join(', ') : '—'}</span>

              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>ai_status</span>
              <span style={{ fontFamily: 'monospace' }}>
                {note.epistemic_status}
                {note.verified_at ? ` (verified ${note.verified_at})` : ''}
              </span>
            </div>
          </div>
        )}

        {mode === 'read' ? (
          /* ==================== READ NODE VIEW ==================== */
          <>
            <h1 className="node-title">{note.title}</h1>

            {note.aliases.length > 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>
                Also known as:{' '}
                {note.aliases.map((a) => (
                  <span
                    key={a}
                    style={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 11.5,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'var(--bg-panel)',
                      marginRight: 6,
                    }}
                  >
                    {a}
                  </span>
                ))}
              </div>
            )}

            {/* Epistemic Provenance & Verification Banner */}
            <div className={`epistemic-banner ${isVerified ? 'verified' : 'ai-pending'}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {isVerified ? (
                  <CheckCircle2 size={20} color="var(--verified-emerald)" />
                ) : (
                  <AlertTriangle size={20} color="var(--ai-amber)" />
                )}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                    {isVerified
                      ? 'Verified Node — All Knowledge Claims Audited'
                      : `Unverified AI Content Present (${note.ai_segments.length} segment${
                          note.ai_segments.length === 1 ? '' : 's'
                        } pending review)`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {isVerified
                      ? `Verified on ${note.verified_at || note.updated_at} • Standard archival ink`
                      : `Source: ${
                          note.ai_source || 'AI Draft'
                        } • Review Amber highlights and click Verify`}
                  </div>
                </div>
              </div>

              {!isVerified && (
                <button type="button" className="btn-primary" onClick={onVerifyEntireNote}>
                  <CheckCircle2 size={14} /> Verify Entire Node
                </button>
              )}
            </div>

            <article onMouseUp={handleMouseUpSelection}>{renderedBlocks}</article>

            {note.sources.length > 0 && (
              <div
                onMouseUp={(e) => e.stopPropagation()}
                style={{
                  marginTop: 42,
                  paddingTop: 20,
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <div
                  style={{
                    fontSize: 11.5,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    marginBottom: 10,
                  }}
                >
                  Primary Sources & Citations
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {note.sources.map((src) => (
                    <a
                      key={src}
                      href={src}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13,
                        color: 'var(--hypha-link)',
                        textDecoration: 'none',
                      }}
                    >
                      <ExternalLink size={13} /> {src}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ==================== WRITE NODE VIEW (Matches Read Layout!) ==================== */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* In-Place Editable Serif Title */}
            <input
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Node Title..."
              className="node-title"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px dashed var(--border-strong)',
                paddingBottom: 8,
                marginBottom: 4,
                outline: 'none',
              }}
            />

            {/* Compact Editable Metadata Pills (Scope, Clusters with Anti-Typo Suggestions, Aliases) */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 14,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Node Scope (Disambiguation Subtitle)
                  </label>
                  <textarea
                    rows={1}
                    ref={(el) => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${Math.max(32, el.scrollHeight)}px`;
                      }
                    }}
                    value={editScope}
                    onChange={(e) => setEditScope(e.target.value)}
                    placeholder="e.g. Biological filament vs. App link..."
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      resize: 'none',
                      overflow: 'hidden',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Clusters (#tags)
                  </label>
                  <textarea
                    rows={1}
                    ref={(el) => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${Math.max(32, el.scrollHeight)}px`;
                      }
                    }}
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="biology, fungi, network"
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      resize: 'none',
                      overflow: 'hidden',
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Aliases (comma-separated)
                  </label>
                  <textarea
                    rows={1}
                    ref={(el) => {
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${Math.max(32, el.scrollHeight)}px`;
                      }
                    }}
                    value={editAliases}
                    onChange={(e) => setEditAliases(e.target.value)}
                    placeholder="Hypha, Hyphae"
                    style={{
                      width: '100%',
                      marginTop: 4,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-elevated)',
                      color: 'var(--text-primary)',
                      fontFamily: 'inherit',
                      fontSize: 12.5,
                      lineHeight: 1.45,
                      resize: 'none',
                      overflow: 'hidden',
                    }}
                  />
                </div>
              </div>

              {/* Existing Colony Cluster Tag Suggestions (Click to toggle — prevents typos!) */}
              {colonyClusters.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexWrap: 'wrap',
                    paddingTop: 6,
                    borderTop: '1px dashed var(--border-subtle)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Tag size={11} color="var(--hypha-link)" /> Existing Colony Clusters (click to
                    toggle):
                  </span>
                  {colonyClusters.map(([clusterName, count]) => {
                    const isSelected = currentTagList.includes(clusterName);
                    const isTypingMatch =
                      partialTagQuery.length > 0 &&
                      !isSelected &&
                      clusterName.toLowerCase().includes(partialTagQuery);
                    return (
                      <button
                        key={clusterName}
                        type="button"
                        onClick={() => toggleClusterTagInEditor(clusterName)}
                        className="btn-subtle"
                        style={{
                          padding: '2px 9px',
                          fontSize: 11,
                          borderRadius: 999,
                          background: isSelected
                            ? 'var(--verified-emerald-bg)'
                            : isTypingMatch
                            ? 'var(--ai-amber-bg)'
                            : 'var(--bg-elevated)',
                          borderColor: isSelected
                            ? 'var(--verified-emerald)'
                            : isTypingMatch
                            ? 'var(--ai-amber)'
                            : 'var(--border-subtle)',
                          color: isSelected
                            ? 'var(--verified-emerald)'
                            : isTypingMatch
                            ? 'var(--ai-amber)'
                            : 'var(--text-secondary)',
                          fontWeight: isSelected || isTypingMatch ? 700 : 500,
                        }}
                        title={
                          isSelected
                            ? `Click to remove #${clusterName}`
                            : `Click to add existing Colony Cluster #${clusterName} (${count} Nodes)`
                        }
                      >
                        {isSelected ? '✓' : '+'} #{clusterName}{' '}
                        <span style={{ opacity: 0.65, fontSize: 10 }}>({count})</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Primary Sources & Citations Editable Field in Write Mode */}
              <div
                style={{
                  paddingTop: 8,
                  borderTop: '1px dashed var(--border-subtle)',
                }}
              >
                <label
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <ExternalLink size={11} color="var(--hypha-link)" /> Primary Sources & Citations (1 URL or reference per line)
                </label>
                <textarea
                  rows={2}
                  ref={(el) => {
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = `${Math.max(46, el.scrollHeight)}px`;
                    }
                  }}
                  value={editSources}
                  onChange={(e) => setEditSources(e.target.value)}
                  placeholder={'https://en.wikipedia.org/wiki/Mycelium\nhttps://doi.org/10.1038/...'}
                  style={{
                    width: '100%',
                    marginTop: 4,
                    padding: '6px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-primary)',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 12,
                    lineHeight: 1.5,
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>

            {/* Subtle Formatting, Media & Hypha Quick-Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
                padding: '8px 12px',
                borderRadius: 999,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <select
                  value={selectedHyphaTarget}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                      insertIntoBody(`[[${val}]]`);
                      setSelectedHyphaTarget('');
                    }
                  }}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <option value="">+ Connect [[Hypha]]...</option>
                  {allNotes
                    .filter((n) => n.id !== note.id)
                    .map((n) => (
                      <option key={n.id} value={n.title}>
                        [[{n.title}]] ({n.tags[0] || 'node'})
                      </option>
                    ))}
                </select>

                {/* Media & Note Embed Selector */}
                <select
                  value={selectedEmbedTarget}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    if (val === '__upload__') {
                      mediaFileInputRef.current?.click();
                    } else if (val === '__diagram__') {
                      insertIntoBody(
                        `![[assets/mycelium-neural-diagram.svg|Comparative Topology Diagram]]`
                      );
                    } else if (val === '__mermaid__') {
                      insertIntoBody(
                        '```mermaid\ngraph LR\n  A["Spore"] --> B["Hypha"]\n  B --> C["Mycelium Network"]\n```'
                      );
                    } else {
                      insertIntoBody(`![[${val}|Embedded Reference: ${val}]]`);
                    }
                    setSelectedEmbedTarget('');
                  }}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 999,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <option value="">+ Embed Media / ![[Node]]...</option>
                  <option value="__upload__">🖼️ Upload Image / Audio / Video / PDF...</option>
                  <option value="__diagram__">
                    🖼️ Embed Sample SVG (![[assets/mycelium-neural-diagram.svg]])
                  </option>
                  <option value="__mermaid__">📊 Insert Mermaid Flowchart (```mermaid)</option>
                  <optgroup label="Embed Colony Node (![[Transclusion]])">
                    {allNotes
                      .filter((n) => n.id !== note.id)
                      .map((n) => (
                        <option key={n.id} value={n.title}>
                          ![[{n.title}]]
                        </option>
                      ))}
                  </optgroup>
                </select>
                <input
                  ref={mediaFileInputRef}
                  type="file"
                  accept="image/*,audio/*,video/*,.pdf,.svg"
                  style={{ display: 'none' }}
                  onChange={handleMediaFileUpload}
                />

                <button
                  type="button"
                  className="btn-subtle"
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => insertIntoBody('## Section Heading')}
                >
                  <Heading2 size={12} /> Heading
                </button>

                <button
                  type="button"
                  className="btn-subtle"
                  style={{ padding: '4px 10px', fontSize: 11.5 }}
                  onClick={() => insertIntoBody('- Key point referencing [[' + (allNotes[0]?.title || 'Node') + ']]')}
                >
                  <List size={12} /> Bullet
                </button>

                {/* Explicit Segmented Editor Mode Switcher: Live Preview ON vs Code Editor (.md) [Live Preview OFF] vs Raw YAML */}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 2,
                    padding: 2,
                    borderRadius: 999,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                  }}
                  title="Switch between Live Preview (line-by-line), Code Editor (.md with Live Preview OFF), or Raw YAML + .md"
                >
                  <button
                    type="button"
                    onClick={() => changeWriteSubMode('live-preview')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: 'none',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background:
                        writeSubMode === 'live-preview'
                          ? 'var(--verified-emerald-bg)'
                          : 'transparent',
                      color:
                        writeSubMode === 'live-preview'
                          ? 'var(--verified-emerald)'
                          : 'var(--text-secondary)',
                    }}
                    title="Live Preview ON: Render Markdown inline and click any line to edit"
                  >
                    <Eye size={12} /> Live Preview
                  </button>

                  <button
                    type="button"
                    onClick={() => changeWriteSubMode('continuous')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '4px 10px',
                      borderRadius: 999,
                      border: 'none',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background:
                        writeSubMode === 'continuous'
                          ? 'var(--hypha-link-bg)'
                          : 'transparent',
                      color:
                        writeSubMode === 'continuous'
                          ? 'var(--hypha-link)'
                          : 'var(--text-secondary)',
                    }}
                    title="Turn OFF Live Preview: Full long-form .md Code Editor with line numbers"
                  >
                    <Code2 size={12} /> Code Editor (.md)
                  </button>

                  <button
                    type="button"
                    onClick={() => changeWriteSubMode('raw-yaml')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 9px',
                      borderRadius: 999,
                      border: 'none',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background:
                        writeSubMode === 'raw-yaml'
                          ? 'var(--bg-panel)'
                          : 'transparent',
                      color:
                        writeSubMode === 'raw-yaml'
                          ? 'var(--text-primary)'
                          : 'var(--text-muted)',
                    }}
                    title="Edit raw YAML frontmatter + Markdown source directly"
                  >
                    <FileText size={11} /> Raw YAML
                  </button>
                </div>

                <button
                  type="button"
                  className="btn-subtle"
                  style={{
                    padding: '4px 10px',
                    fontSize: 11.5,
                    borderColor: showSyntaxGuide ? 'var(--hypha-link)' : undefined,
                    color: showSyntaxGuide ? 'var(--hypha-link)' : 'var(--text-secondary)',
                    background: showSyntaxGuide ? 'var(--hypha-link-bg)' : undefined,
                  }}
                  onClick={() => setShowSyntaxGuide((v) => !v)}
                  title="Toggle Markdown & Hypha Syntax Reference Guide (1-click snippet insertion)"
                >
                  <BookOpen size={12} /> Syntax Guide {showSyntaxGuide ? '▴' : '▾'}
                </button>
              </div>

              {/* Small, Unobtrusive AI Assist Toggle + Save Button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="btn-subtle"
                  style={{
                    padding: '4px 10px',
                    fontSize: 11.5,
                    color: 'var(--text-secondary)',
                  }}
                  onClick={() => setShowCompactAi((v) => !v)}
                  title="Optional AI helper to draft a paragraph"
                >
                  <Sparkles size={12} color="var(--ai-amber)" /> AI Helper
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  style={{ padding: '5px 14px', fontSize: 12 }}
                  onClick={() => handleSaveStructured(true)}
                >
                  <Save size={13} /> Save Node
                </button>
              </div>
            </div>

            {/* Quick Syntax Strip + Expandable Full Syntax Reference Guide */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 14,
                background: 'var(--bg-panel)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--text-muted)',
                      marginRight: 4,
                    }}
                  >
                    Syntax Snippets:
                  </span>
                  {[
                    {
                      label: '[[Hypha]]',
                      hint: 'Link to a Colony Node',
                      snippet: `[[${allNotes.find((n) => n.id !== note.id)?.title || 'Mycelium Network'}]]`,
                      inline: true,
                    },
                    {
                      label: '[[Node|Alias]]',
                      hint: 'Link with custom display label',
                      snippet: `[[${allNotes.find((n) => n.id !== note.id)?.title || 'Fungi'}|custom label]]`,
                      inline: true,
                    },
                    {
                      label: '![[Transclude]]',
                      hint: 'Embed another Node or #Section inline',
                      snippet: `![[${allNotes.find((n) => n.id !== note.id)?.title || 'Spore'}]]`,
                      inline: false,
                    },
                    {
                      label: '**Bold**',
                      hint: 'Strong emphasis',
                      snippet: '**bold text**',
                      inline: true,
                    },
                    {
                      label: '==Highlight==',
                      hint: 'Highlight key insight',
                      snippet: '==highlighted insight==',
                      inline: true,
                    },
                    {
                      label: '- [ ] Task',
                      hint: 'Interactive checklist item',
                      snippet: '- [ ] Verify experimental claim',
                      inline: false,
                    },
                    {
                      label: '> [!info]+ Callout',
                      hint: 'Collapsible callout box',
                      snippet: '> [!info]+ Key Observation\n> Supporting context linked to [[' + (allNotes[0]?.title || 'Fungi') + ']].',
                      inline: false,
                    },
                    {
                      label: '$$ Math $$',
                      hint: 'LaTeX math equation block',
                      snippet: '$$\nW_{ij}^{(t+1)} = W_{ij}^{(t)} + \\eta \\cdot \\Delta \n$$',
                      inline: false,
                    },
                    {
                      label: '```code```',
                      hint: 'Fenced code block',
                      snippet: '```ts\nconst colony = { verified: true };\n```',
                      inline: false,
                    },
                    {
                      label: '[^1] Footnote',
                      hint: 'Inline citation + bottom reference',
                      snippet: 'citation[^1]\n\n[^1]: Primary source reference or DOI.',
                      inline: true,
                    },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => insertIntoBody(item.snippet, item.inline)}
                      title={`${item.hint} — Click to insert`}
                      style={{
                        padding: '2px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-elevated)',
                        color: 'var(--text-secondary)',
                        fontFamily: '"JetBrains Mono", monospace',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setShowSyntaxGuide((v) => !v)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--hypha-link)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {showSyntaxGuide ? 'Hide Full Guide ▴' : 'Full Syntax Cheat Sheet ▾'}
                </button>
              </div>

              {showSyntaxGuide && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))',
                    gap: 10,
                    paddingTop: 8,
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  {/* Column 1: Hypha Links & Embeds */}
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--hypha-link)',
                      }}
                    >
                      1. Hypha Links & Transclusion
                    </div>
                    {[
                      {
                        syntax: '[[Node Title]]',
                        desc: 'Directional Hypha link to another Node',
                        insert: `[[${allNotes.find((n) => n.id !== note.id)?.title || 'Fungi'}]]`,
                        inline: true,
                      },
                      {
                        syntax: '[[Node|Custom Label]]',
                        desc: 'Link to Node with alias display text',
                        insert: `[[${allNotes.find((n) => n.id !== note.id)?.title || 'Fungi'}|fungal kingdom]]`,
                        inline: true,
                      },
                      {
                        syntax: '[[Node#Section Heading]]',
                        desc: 'Deep link directly to a heading anchor',
                        insert: '[[Mycelium Network#Structural Parallels: Fungi, Brains, and Knowledge]]',
                        inline: true,
                      },
                      {
                        syntax: '![[Node#Section Heading]]',
                        desc: 'Transclude / embed section content live',
                        insert: '![[Spore#Germination into a Hypha]]',
                        inline: false,
                      },
                      {
                        syntax: '![[assets/file.svg|520]]',
                        desc: 'Embed image, SVG, audio, video, or PDF with width',
                        insert: '![[assets/mycelium-neural-diagram.svg|520]]',
                        inline: false,
                      },
                    ].map((row) => (
                      <button
                        key={row.syntax}
                        type="button"
                        onClick={() => insertIntoBody(row.insert, row.inline)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: 2,
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        title="Click to insert into editor"
                      >
                        <code
                          style={{
                            fontSize: 11,
                            color: 'var(--hypha-link)',
                            fontFamily: '"JetBrains Mono", monospace',
                          }}
                        >
                          {row.syntax}
                        </code>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {row.desc}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Column 2: Formatting, Tasks & Citations */}
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--verified-emerald)',
                      }}
                    >
                      2. Formatting, Tasks & Clusters
                    </div>
                    {[
                      {
                        syntax: '**Bold**  *Italic*  `Code`',
                        desc: 'Standard inline typography & inline code',
                        insert: '**bold term**, *italic nuance*, and `inline_code()`',
                        inline: true,
                      },
                      {
                        syntax: '==Highlighted Passage==',
                        desc: 'Epistemic highlight marker',
                        insert: '==key verified finding==',
                        inline: true,
                      },
                      {
                        syntax: '- [ ] Task  /  - [x] Done',
                        desc: 'Interactive checkbox (clickable in Read mode)',
                        insert: '- [ ] Cross-check citation with primary literature\n- [x] Link core Colony Nodes',
                        inline: false,
                      },
                      {
                        syntax: 'Claim[^1] ... [^1]: Source',
                        desc: 'Numbered academic footnote & reference',
                        insert: 'Verified observation[^1]\n\n[^1]: Simard et al., Nature (1997).',
                        inline: true,
                      },
                      {
                        syntax: 'Type [[ , # , or / inline',
                        desc: 'Triggers instant autocomplete in both Live & Code modes',
                        insert: `[[${allNotes[0]?.title || 'Fungi'}]]`,
                        inline: true,
                      },
                    ].map((row) => (
                      <button
                        key={row.syntax}
                        type="button"
                        onClick={() => insertIntoBody(row.insert, row.inline)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: 2,
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        title="Click to insert into editor"
                      >
                        <code
                          style={{
                            fontSize: 11,
                            color: 'var(--verified-emerald)',
                            fontFamily: '"JetBrains Mono", monospace',
                          }}
                        >
                          {row.syntax}
                        </code>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {row.desc}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Column 3: Callouts, AI Claims, Math & Diagrams */}
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        color: 'var(--ai-amber)',
                      }}
                    >
                      3. Callouts, Epistemic AI, Math & Tables
                    </div>
                    {[
                      {
                        syntax: '> [!info]+ Callout Title',
                        desc: 'Foldable callout (+ expanded, - folded: info, tip, warning)',
                        insert: '> [!tip]+ Synthesis Note\n> Combine [[Hypha (Biology)]] with [[Artificial Neural Network]] topology.',
                        inline: false,
                      },
                      {
                        syntax: '> [!ai] Unverified Claim',
                        desc: 'Marks statement as Amber AI Draft until human-verified',
                        insert: '> [!ai] Signal propagation along fungal hyphae spikes at 0.5–5 Hz under nutrient stress.',
                        inline: false,
                      },
                      {
                        syntax: '$$ LaTeX Equation $$',
                        desc: 'Display math block (or $inline$ math)',
                        insert: '$$\nI(X; Y) = \\sum_{x,y} p(x,y) \\log \\frac{p(x,y)}{p(x)p(y)}\n$$',
                        inline: false,
                      },
                      {
                        syntax: '```mermaid ... ```',
                        desc: 'Render live SVG graph or sequence diagram',
                        insert: '```mermaid\ngraph LR\n  A["Spore"] --> B["Hypha"]\n  B --> C["Mycelium Network"]\n```',
                        inline: false,
                      },
                      {
                        syntax: '| Col 1 | Col 2 |',
                        desc: 'Structured Markdown comparison table',
                        insert: '| Domain | Unit | Link |\n| :--- | :--- | :--- |\n| Biology | [[Hypha (Biology)]] | Chemical / Electrical |\n| Computing | [[Node (Graph & Neural)]] | Weighted Tensor |',
                        inline: false,
                      },
                    ].map((row) => (
                      <button
                        key={row.syntax}
                        type="button"
                        onClick={() => insertIntoBody(row.insert, row.inline)}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-start',
                          gap: 2,
                          padding: '5px 8px',
                          borderRadius: 8,
                          background: 'var(--bg-panel)',
                          border: '1px solid var(--border-subtle)',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                        title="Click to insert into editor"
                      >
                        <code
                          style={{
                            fontSize: 11,
                            color: 'var(--ai-amber)',
                            fontFamily: '"JetBrains Mono", monospace',
                          }}
                        >
                          {row.syntax}
                        </code>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          {row.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Optional Small Collapsible AI Helper Bar */}
            {showCompactAi && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 14,
                  background: 'var(--ai-amber-bg)',
                  border: '1px solid var(--ai-amber-border)',
                }}
              >
                <Sparkles size={14} color="var(--ai-amber)" />
                <input
                  type="text"
                  value={compactAiTopic}
                  onChange={(e) => setCompactAiTopic(e.target.value)}
                  placeholder={`Ask AI to draft a paragraph for "${editTitle}"...`}
                  style={{
                    flex: 1,
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-elevated)',
                    fontSize: 12.5,
                  }}
                />
                <button
                  type="button"
                  className="btn-amber"
                  style={{ padding: '5px 12px', fontSize: 11.5 }}
                  disabled={compactAiLoading}
                  onClick={async () => {
                    const q = (compactAiTopic || editTitle).trim();
                    if (!q) return;
                    setCompactAiLoading(true);
                    try {
                      const res = await onRunAiResearch({
                        topic: q,
                        mode: 'agent_research',
                        existing_titles: allNotes.map((n) => n.title),
                      });
                      insertIntoBody(res.markdown_block);
                      setShowCompactAi(false);
                      setCompactAiTopic('');
                    } finally {
                      setCompactAiLoading(false);
                    }
                  }}
                >
                  <Plus size={12} /> {compactAiLoading ? 'Drafting...' : 'Insert AI Paragraph'}
                </button>
              </div>
            )}

            {/* ==================== MAIN WRITING SURFACE ==================== */}
            {writeSubMode === 'raw-yaml' ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: 11,
                    fontFamily: '"JetBrains Mono", monospace',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>RAW YAML FRONTMATTER + MARKDOWN SOURCE • LIVE PREVIEW OFF</span>
                  <button
                    type="button"
                    className="btn-subtle"
                    style={{ padding: '2px 8px', fontSize: 10.5 }}
                    onClick={() => changeWriteSubMode('live-preview')}
                  >
                    <Eye size={11} /> Switch to Live Preview
                  </button>
                </div>
                <textarea
                  ref={(el) => {
                    if (el) {
                      el.style.height = 'auto';
                      el.style.height = `${Math.max(420, el.scrollHeight)}px`;
                    }
                  }}
                  value={rawDraft}
                  onChange={(e) => {
                    e.currentTarget.style.height = 'auto';
                    e.currentTarget.style.height = `${Math.max(420, e.currentTarget.scrollHeight)}px`;
                    setRawDraft(e.target.value);
                  }}
                  style={{
                    width: '100%',
                    minHeight: 420,
                    padding: '18px 20px',
                    borderRadius: 16,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-canvas)',
                    color: 'var(--text-primary)',
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 13.5,
                    lineHeight: 1.75,
                    resize: 'none',
                    overflow: 'hidden',
                  }}
                />
              </div>
            ) : writeSubMode === 'continuous' ? (
              /* FULL LONG-FORM CODE EDITOR (.MD) WITH LIVE PREVIEW OFF, LINE NUMBERS, TAB INDENT & INLINE AUTOCOMPLETE */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    padding: '8px 14px',
                    borderRadius: 12,
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        fontSize: 11,
                        fontWeight: 700,
                        fontFamily: '"JetBrains Mono", monospace',
                        color: 'var(--hypha-link)',
                      }}
                    >
                      <Code2 size={13} /> CODE EDITOR (.MD) • LIVE PREVIEW OFF
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontFamily: '"JetBrains Mono", monospace',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {editBody.split('\n').length} lines • {editBody.length} chars • Tab = 2 spaces • Type [[ # / for autocomplete
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn-subtle"
                    style={{ padding: '3px 10px', fontSize: 11 }}
                    onClick={() => changeWriteSubMode('live-preview')}
                    title="Turn Live Preview back ON"
                  >
                    <Eye size={11} /> Enable Live Preview
                  </button>
                </div>

                {/* Floating Autocomplete Bar when typing [[, #, or / in Code Editor */}
                {inlineTrigger && inlineAutocompleteItems.length > 0 && (
                  <div
                    style={{
                      padding: 8,
                      borderRadius: 12,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--hypha-link)',
                      boxShadow: 'var(--shadow-card)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--hypha-link)',
                        padding: '2px 6px',
                      }}
                    >
                      {inlineTrigger.kind === 'hypha'
                        ? 'Connect [[Hypha]] or Section (#Heading) — Click to insert at cursor'
                        : inlineTrigger.kind === 'cluster'
                        ? 'Colony #Cluster Tags — Click to insert at cursor'
                        : 'Slash Snippet Commands — Click to insert at cursor'}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {inlineAutocompleteItems.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            const el = codeEditorRef.current;
                            const cursor = el?.selectionStart ?? editBody.length;
                            const beforeCursor = editBody.slice(0, cursor);
                            const afterCursor = editBody.slice(cursor);
                            const replacedBefore = applyInlineAutocomplete(beforeCursor, item.insert);
                            const nextBody = `${replacedBefore}${afterCursor}`;
                            setEditBody(nextBody);
                            setInlineTrigger(null);
                            requestAnimationFrame(() => {
                              if (el) {
                                el.focus();
                                const newPos = replacedBefore.length;
                                el.setSelectionRange(newPos, newPos);
                              }
                            });
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '5px 10px',
                            borderRadius: 8,
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{item.label}</span>
                          <span
                            style={{
                              fontSize: 10,
                              fontFamily: '"JetBrains Mono", monospace',
                              color: 'var(--hypha-link)',
                            }}
                          >
                            {item.badge}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'stretch',
                    borderRadius: 16,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-canvas)',
                    overflow: 'hidden',
                  }}
                >
                  {/* Synchronized Monospace Line-Number Gutter */}
                  <div
                    aria-hidden="true"
                    style={{
                      padding: '18px 10px 18px 14px',
                      background: 'var(--bg-panel)',
                      borderRight: '1px solid var(--border-subtle)',
                      color: 'var(--text-muted)',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 13.5,
                      lineHeight: '24px',
                      textAlign: 'right',
                      userSelect: 'none',
                      minWidth: 46,
                      opacity: 0.65,
                    }}
                  >
                    {editBody.split('\n').map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>

                  <textarea
                    ref={(el) => {
                      codeEditorRef.current = el;
                      if (el) {
                        el.style.height = 'auto';
                        el.style.height = `${Math.max(460, el.scrollHeight)}px`;
                      }
                    }}
                    value={editBody}
                    onChange={(e) => {
                      e.currentTarget.style.height = 'auto';
                      e.currentTarget.style.height = `${Math.max(460, e.currentTarget.scrollHeight)}px`;
                      const val = e.target.value;
                      const cursor = e.currentTarget.selectionStart ?? val.length;
                      setEditBody(val);
                      detectInlineTrigger(val.slice(0, cursor));
                    }}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                        e.preventDefault();
                        handleSaveStructured(false);
                      } else if (e.key === 'Tab') {
                        e.preventDefault();
                        const el = e.currentTarget;
                        const start = el.selectionStart ?? 0;
                        const end = el.selectionEnd ?? 0;
                        const next = `${editBody.slice(0, start)}  ${editBody.slice(end)}`;
                        setEditBody(next);
                        requestAnimationFrame(() => {
                          el.setSelectionRange(start + 2, start + 2);
                        });
                      } else if (e.key === 'Escape' && inlineTrigger) {
                        setInlineTrigger(null);
                      }
                    }}
                    placeholder="Write continuous Markdown (.md) here... Type [[ for Hypha links, # for Clusters, or / for Slash commands."
                    style={{
                      flex: 1,
                      width: '100%',
                      minHeight: 460,
                      padding: '18px 20px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: 13.5,
                      lineHeight: '24px',
                      resize: 'none',
                      overflow: 'hidden',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
            ) : (
              /* LINE-BY-LINE LIVE PREVIEW EDITOR (Click any line to edit its .md syntax!) */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minHeight: 380,
                }}
              >
                <div
                  style={{
                    fontSize: 11.5,
                    color: 'var(--text-muted)',
                    marginBottom: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <span>
                    <strong>Live Preview:</strong> Click any line or block below to reveal
                    its raw <code>.md</code> syntax. Type <code>[[</code> for Nodes,{' '}
                    <code>#</code> for Clusters, or <code>/</code> for commands.
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className="btn-subtle"
                      style={{ padding: '2px 8px', fontSize: 10.5 }}
                      onClick={() => changeWriteSubMode('continuous')}
                      title="Turn OFF Live Preview and switch to continuous long-form Code Editor (.md)"
                    >
                      <Code2 size={11} /> Turn Off Live Preview (Code Editor)
                    </button>
                    <button
                      type="button"
                      className="btn-subtle"
                      style={{ padding: '2px 8px', fontSize: 10.5 }}
                      onClick={() => {
                        const nextIdx = livePreviewLines.length;
                        setEditBody((prev) => `${prev}\n`);
                        setActiveLiveLineIdx(nextIdx);
                      }}
                    >
                      + New Line
                    </button>
                  </div>
                </div>

                {livePreviewLines.map((lineStr, idx) => {
                  const isEditingThisLine = activeLiveLineIdx === idx;
                  const isMultiLineBlock = lineStr.includes('\n');

                  if (isEditingThisLine) {
                    return (
                      <div
                        key={`live-edit-${idx}`}
                        style={{
                          position: 'relative',
                          margin: '4px 0',
                          padding: '8px 12px',
                          borderRadius: 12,
                          background: 'var(--bg-panel)',
                          border: '1.5px solid var(--hypha-link)',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 4,
                            fontSize: 10,
                            fontFamily: '"JetBrains Mono", monospace',
                            color: 'var(--hypha-link)',
                          }}
                        >
                          <span>
                            L{idx + 1} • Raw Markdown Active (Enter = new line, Esc = preview)
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveLiveLineIdx(null);
                              setInlineTrigger(null);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              fontSize: 10.5,
                            }}
                          >
                            Done ✓
                          </button>
                        </div>

                        <textarea
                          autoFocus
                          rows={1}
                          ref={(el) => {
                            if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${Math.max(28, el.scrollHeight)}px`;
                            }
                          }}
                          value={lineStr}
                          onChange={(e) => {
                            e.currentTarget.style.height = 'auto';
                            e.currentTarget.style.height = `${Math.max(28, e.currentTarget.scrollHeight)}px`;
                            updateLiveLineAt(idx, e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setActiveLiveLineIdx(null);
                              setInlineTrigger(null);
                            } else if (e.key === 'Enter' && !e.shiftKey && !isMultiLineBlock) {
                              e.preventDefault();
                              const copy = [...livePreviewLines];
                              copy.splice(idx + 1, 0, '');
                              setEditBody(copy.join('\n'));
                              setActiveLiveLineIdx(idx + 1);
                              setInlineTrigger(null);
                            } else if (
                              e.key === 'ArrowUp' &&
                              !isMultiLineBlock &&
                              idx > 0 &&
                              e.currentTarget.selectionStart === 0
                            ) {
                              e.preventDefault();
                              setActiveLiveLineIdx(idx - 1);
                              setInlineTrigger(null);
                            } else if (
                              e.key === 'ArrowDown' &&
                              !isMultiLineBlock &&
                              idx < livePreviewLines.length - 1 &&
                              e.currentTarget.selectionEnd === lineStr.length
                            ) {
                              e.preventDefault();
                              setActiveLiveLineIdx(idx + 1);
                              setInlineTrigger(null);
                            } else if (
                              e.key === 'Backspace' &&
                              lineStr === '' &&
                              livePreviewLines.length > 1
                            ) {
                              e.preventDefault();
                              const copy = [...livePreviewLines];
                              copy.splice(idx, 1);
                              setEditBody(copy.join('\n'));
                              setActiveLiveLineIdx(Math.max(0, idx - 1));
                            }
                          }}
                          placeholder="Type Markdown, [[Hypha]], #Cluster, or /command..."
                          style={{
                            width: '100%',
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            color: 'var(--text-primary)',
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: 14,
                            lineHeight: 1.7,
                            resize: 'none',
                            overflow: 'hidden',
                            display: 'block',
                          }}
                        />

                        {/* Inline Autocomplete Menu for [[Hypha]], #Cluster, or /Slash */}
                        {inlineTrigger && inlineAutocompleteItems.length > 0 && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: 6,
                              borderRadius: 12,
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border-strong)',
                              boxShadow: 'var(--shadow-card)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                color: 'var(--text-muted)',
                                padding: '2px 6px',
                              }}
                            >
                              {inlineTrigger.kind === 'hypha'
                                ? 'Connect [[Hypha]] or Section (#Heading)'
                                : inlineTrigger.kind === 'cluster'
                                ? 'Colony #Cluster Tags'
                                : 'Slash Commands'}
                            </div>
                            {inlineAutocompleteItems.map((item) => (
                              <button
                                key={item.label}
                                type="button"
                                onClick={() => {
                                  const nextLine = applyInlineAutocomplete(lineStr, item.insert);
                                  updateLiveLineAt(idx, nextLine);
                                  setInlineTrigger(null);
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '6px 10px',
                                  borderRadius: 8,
                                  background: 'var(--bg-panel)',
                                  border: '1px solid var(--border-subtle)',
                                  color: 'var(--text-primary)',
                                  fontSize: 12.5,
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                }}
                              >
                                <span style={{ fontWeight: 600 }}>{item.label}</span>
                                <span
                                  style={{
                                    fontSize: 10.5,
                                    fontFamily: '"JetBrains Mono", monospace',
                                    color: 'var(--hypha-link)',
                                  }}
                                >
                                  {item.badge}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }

                  // Unfocused Line: Render as Live Formatted Preview! Clicking opens Raw Markdown for this line
                  return (
                    <div
                      key={`live-prev-${idx}`}
                      onClick={() => {
                        setActiveLiveLineIdx(idx);
                        detectInlineTrigger(lineStr);
                      }}
                      style={{
                        padding: lineStr.trim() ? '2px 8px' : '8px',
                        borderRadius: 10,
                        cursor: 'text',
                        border: '1px solid transparent',
                        transition: 'background 0.12s ease, border-color 0.12s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--bg-panel)';
                        e.currentTarget.style.borderColor = 'var(--border-subtle)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderColor = 'transparent';
                      }}
                      title="Click line to edit Markdown syntax in-place"
                    >
                      {lineStr.trim() ? (
                        renderMarkdownFragment(lineStr, false)
                      ) : (
                        <div
                          style={{
                            height: 14,
                            borderLeft: '2px dashed var(--border-subtle)',
                            paddingLeft: 8,
                            fontSize: 11,
                            color: 'var(--text-muted)',
                            opacity: 0.45,
                          }}
                        >
                          ¶ Empty line (click to write)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Text Selection Floating Action Bar & Missing-Node Connect Hypha Prompt */}
      {selectedText && (
        <div
          onClick={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: selectedText.y,
            left: Math.min(window.innerWidth - 420, Math.max(20, selectedText.x - 180)),
            transform: 'translateY(-100%)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 16,
            padding: '7px 11px',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 6,
            zIndex: 55,
          }}
        >
          {connectHyphaPrompt ? (
            <>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  padding: '0 4px',
                }}
              >
                No Node for <strong>"{connectHyphaPrompt.term.slice(0, 22)}"</strong> yet:
              </span>
              <button
                type="button"
                className="btn-primary"
                style={{ fontSize: 11.5, padding: '4px 10px' }}
                onClick={async () => {
                  const term = connectHyphaPrompt.term;
                  setConnectHyphaPrompt(null);
                  setSelectedText(null);
                  window.getSelection()?.removeAllRanges();
                  setReadUndoStack((prev) => [
                    ...prev.slice(-39),
                    { markdown: note.raw_markdown, label: `Connected [[${term}]]` },
                  ]);
                  setReadRedoStack([]);
                  if (onCreateBackgroundNote) {
                    await onCreateBackgroundNote(term, term);
                  } else {
                    commitLinkTermWithUndo(term, term);
                  }
                  setStatusToast(`Created "${term}.md" in Colony & connected [[${term}]]`);
                  setTimeout(() => setStatusToast(null), 3200);
                }}
                title="Create a new .md Node in the background and connect [[Hypha]] while staying on this page"
              >
                <Plus size={12} /> 1. Create New .md
              </button>
              <button
                type="button"
                className="btn-subtle"
                style={{
                  fontSize: 11.5,
                  padding: '4px 10px',
                  color: '#EF4444',
                  borderColor: 'rgba(239, 68, 68, 0.45)',
                }}
                onClick={() => {
                  const term = connectHyphaPrompt.term;
                  commitLinkTermWithUndo(term, term);
                  setConnectHyphaPrompt(null);
                  setSelectedText(null);
                  window.getSelection()?.removeAllRanges();
                  setStatusToast(`Connected [[${term}]] as unavailable red link`);
                  setTimeout(() => setStatusToast(null), 3200);
                }}
                title="Link [[Hypha]] without creating a .md file (renders as red unavailable link)"
              >
                2. Leave Empty (Red Link)
              </button>
              <button
                type="button"
                className="btn-subtle"
                style={{ fontSize: 11, padding: '4px 7px' }}
                onClick={() => setConnectHyphaPrompt(null)}
              >
                <X size={11} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-subtle"
                style={{ fontSize: 11.5, padding: '4px 10px' }}
                onClick={() => {
                  const cleanTerm = selectedText.text.replace(/\r?\n/g, ' ').trim();
                  if (!cleanTerm) return;
                  const slug = normalizeId(cleanTerm);
                  const existingMatch =
                    entityCatalog.byExactSlug.get(slug) ||
                    (entityCatalog.byTermMulti.get(slug) || [])[0];
                  if (existingMatch) {
                    commitLinkTermWithUndo(cleanTerm, existingMatch.title);
                    setSelectedText(null);
                    window.getSelection()?.removeAllRanges();
                  } else {
                    // Node does not exist yet — ask user whether to 1) Create new .md or 2) Leave empty as red link!
                    setConnectHyphaPrompt({ term: cleanTerm });
                  }
                }}
              >
                <Link2 size={12} /> Connect Hypha [[{selectedText.text.replace(/\r?\n/g, ' ').slice(0, 18)}]]
              </button>
              <button
                type="button"
                className="btn-subtle"
                style={{ fontSize: 11.5, padding: '4px 10px' }}
                onClick={() => {
                  const nextRaw = markSelectionAsAiSafely(note.raw_markdown, selectedText.text);
                  if (nextRaw !== note.raw_markdown) {
                    commitReadMarkdownWithUndo(nextRaw, 'Marked selection as AI pending verification');
                  } else {
                    setStatusToast('Selection cannot be marked (already AI or inside protected link/heading)');
                    setTimeout(() => setStatusToast(null), 2600);
                  }
                  setSelectedText(null);
                  window.getSelection()?.removeAllRanges();
                }}
              >
                Mark as AI
              </button>
              {note.body.includes(`==[AI`) && (
                <button
                  type="button"
                  className="btn-subtle"
                  style={{ fontSize: 11.5, padding: '4px 10px', color: 'var(--ai-amber)' }}
                  onClick={() => {
                    const nextRaw = unmarkAiSpanSafely(note.raw_markdown, selectedText.text);
                    if (nextRaw !== note.raw_markdown) {
                      commitReadMarkdownWithUndo(nextRaw, 'Removed AI flag and restored standard prose');
                    }
                    setSelectedText(null);
                    window.getSelection()?.removeAllRanges();
                  }}
                  title="Remove AI flag from this text"
                >
                  × Unmark AI
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Compact Non-Intrusive Mini Tooltip when Clicking a Red Unavailable Link */}
      {stubUnavailablePill && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: stubUnavailablePill.y,
            left: stubUnavailablePill.x,
            transform: 'translateY(-100%)',
            background: 'var(--bg-elevated)',
            border: '1px solid rgba(239, 68, 68, 0.45)',
            borderRadius: 999,
            padding: '5px 11px',
            boxShadow: 'var(--shadow-soft)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11.5,
            zIndex: 55,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#EF4444',
              display: 'inline-block',
            }}
          />
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Node is unavailable
          </span>
          <button
            type="button"
            className="btn-subtle"
            style={{
              padding: '2px 8px',
              fontSize: 11,
              color: 'var(--verified-emerald)',
              borderColor: 'var(--verified-emerald-border)',
            }}
            onClick={async () => {
              const title = stubUnavailablePill.title;
              setStubUnavailablePill(null);
              if (onCreateBackgroundNote) {
                await onCreateBackgroundNote(title);
                setStatusToast(`Created "${title}.md" in Colony`);
                setTimeout(() => setStatusToast(null), 2400);
              } else {
                onNavigateToNote(title, true);
              }
            }}
            title={`Create ${stubUnavailablePill.title}.md in Colony`}
          >
            + Create .md
          </button>
        </div>
      )}

      {/* Hover Preview & Multi-Node Disambiguation Popover Card */}
      {hoverPreview && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: Math.min(window.innerHeight - 280, hoverPreview.y),
            left: hoverPreview.x,
            width: 356,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 18,
            padding: 16,
            boxShadow: 'var(--shadow-card)',
            zIndex: 45,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {hoverPreview.candidates.length > 1 ? (
            /* MULTI-NODE DISAMBIGUATION PICKER */
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--hypha-link)',
                }}
              >
                <GitBranch size={14} /> Disambiguation: Choose Target Node ({hoverPreview.candidates.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hoverPreview.candidates.map((cand) => (
                  <div
                    key={cand.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
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
                      <span style={{ fontWeight: 700, fontSize: 13.5 }}>{cand.title}</span>
                      <span
                        style={{
                          fontSize: 10.5,
                          padding: '1px 7px',
                          borderRadius: 999,
                          background: 'var(--bg-elevated)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        #{cand.tags[0] || 'colony'}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: 'var(--text-secondary)',
                        marginBottom: 8,
                      }}
                    >
                      {cand.frontmatter.scope ||
                        stripMarkdownToPlainText(cand.body).slice(0, 95) + '...'}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn-subtle"
                        style={{ flex: 1, justifyContent: 'center', fontSize: 11, padding: '4px 8px' }}
                        onClick={() => {
                          onNavigateToNote(cand.id);
                          setHoverPreview(null);
                        }}
                      >
                        Open {cand.title}
                      </button>
                      {hoverPreview.matchedTerm && (
                        <button
                          type="button"
                          className="btn-primary"
                          style={{
                            flex: 1,
                            justifyContent: 'center',
                            fontSize: 11,
                            padding: '4px 8px',
                          }}
                          onClick={() => {
                            onLinkTerm(hoverPreview.matchedTerm!, cand.title);
                            setHoverPreview(null);
                          }}
                        >
                          <Link2 size={11} /> Link Here
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : hoverPreview.candidates.length === 1 ? (
            /* SINGLE NODE PREVIEW */
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 14.5 }}>
                  {hoverPreview.candidates[0].title}
                </span>
                <span className={`status-dot ${hoverPreview.candidates[0].epistemic_status}`} />
              </div>
              {hoverPreview.candidates[0].frontmatter.scope && (
                <div style={{ fontSize: 11.5, color: 'var(--hypha-link)', fontWeight: 600 }}>
                  {hoverPreview.candidates[0].frontmatter.scope}
                </div>
              )}
              <p
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.55,
                }}
              >
                {stripMarkdownToPlainText(hoverPreview.candidates[0].body).slice(0, 145)}
                ...
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn-subtle"
                  style={{ flex: 1, justifyContent: 'center', fontSize: 11.5 }}
                  onClick={() => {
                    onNavigateToNote(hoverPreview.candidates[0].id);
                    setHoverPreview(null);
                  }}
                >
                  Open Node
                </button>
                {hoverPreview.isUnlinkedEntity && hoverPreview.matchedTerm && (
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ flex: 1, justifyContent: 'center', fontSize: 11.5 }}
                    onClick={() => {
                      onLinkTerm(
                        hoverPreview.matchedTerm!,
                        hoverPreview.candidates[0].title
                      );
                      setHoverPreview(null);
                    }}
                  >
                    <Link2 size={12} /> Connect [[Hypha]]
                  </button>
                )}
              </div>
            </>
          ) : (
            /* MISSING STUB NODE */
            <>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {hoverPreview.stubTitle} (Missing Stub Node)
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                This Hypha points to a Node that does not have a .md file in the Colony yet.
              </p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ flex: 1, justifyContent: 'center', fontSize: 11.5 }}
                  onClick={() => {
                    onNavigateToNote(hoverPreview.stubTitle!, true);
                    setHoverPreview(null);
                  }}
                >
                  <Plus size={12} /> Create & Write Node
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Full-Screen Media Lightbox Modal */}
      {lightboxMedia && (
        <div
          onClick={() => setLightboxMedia(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10, 14, 22, 0.86)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 110,
            padding: 28,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90vw',
              maxHeight: '85vh',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-strong)',
              borderRadius: 20,
              padding: 18,
              boxShadow: 'var(--shadow-card)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <ImageIcon size={15} color="var(--verified-emerald)" />
                {lightboxMedia.caption}
              </span>
              <button
                type="button"
                className="btn-subtle"
                onClick={() => setLightboxMedia(null)}
              >
                <X size={14} /> Close
              </button>
            </div>
            <img
              src={lightboxMedia.src}
              alt={lightboxMedia.caption}
              style={{
                maxWidth: '84vw',
                maxHeight: '74vh',
                objectFit: 'contain',
                borderRadius: 12,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};


// Backward compatibility aliases
export const WikiArticleView = NodeDocumentView;
export type WikiArticleViewProps = NodeDocumentViewProps;
