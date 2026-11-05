import {
  AiResearchRequest,
  AiResearchResponse,
  AiSegment,
  BacklinkRef,
  EpistemicStatus,
  GraphEdge,
  GraphNode,
  HeadingRef,
  NoteDocument,
  UnlinkedMention,
  VaultSnapshot,
  VerificationAuditEntry,
  WikiLinkRef,
} from '../types/vault';

export function normalizeId(input: string): string {
  const clean = input
    .trim()
    .replace(/\.md$/i, '')
    .split('#')[0]
    .trim();
  return clean
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Strips Markdown formatting (`**bold**`, `*italic*`, `[[Target|Alias]]`, `> [!callout]`, `==highlight==`, etc.)
 * into clean plain text suitable for Inspector previews and Incoming/Outgoing/Latent Hyphae cards.
 */
export function stripMarkdownToPlainText(input: string): string {
  if (!input) return '';
  return input
    .replace(/^>\s*\[![a-zA-Z0-9_-]+\][+-]?\s*/gm, '')
    .replace(/^>\s*/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => (alias || target).trim())
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, alias) =>
      (alias || target).trim()
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/==\[AI(?::[^\]]+)?\]\s*([\s\S]*?)==/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\^[^\]]+\]:?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripAccidentalAiWrapper(val: string): string {
  return val
    .replace(/==\[AI(?::[^\]]+)?\]\s*([\s\S]*?)==/gi, '$1')
    .trim();
}

/**
 * Strips Obsidian comments `%% ... %%` (both inline and multi-line) for Read mode
 * and parser extraction, without altering the underlying `.md` source in Write mode.
 */
export function stripObsidianComments(markdown: string): string {
  if (!markdown || !markdown.includes('%%')) return markdown;
  return markdown.replace(/%%[\s\S]*?%%/g, '');
}

/**
 * Extracts a specific section (`#Heading`) or block (`^block-id`) from a Markdown body
 * for Obsidian-compatible transclusion (`![[Note#Heading]]` and `![[Note#^block-id]]`).
 */
export function extractNoteSectionOrBlock(markdownBody: string, anchor?: string): string {
  const cleanBody = stripObsidianComments(markdownBody);
  if (!anchor || !anchor.trim()) return cleanBody;
  const trimmedAnchor = anchor.trim();

  // Case 1: Block reference (`^block-id` or `#^block-id`)
  const blockIdMatch = trimmedAnchor.match(/^\^([a-zA-Z0-9_-]+)$/);
  if (blockIdMatch) {
    const targetBlockId = blockIdMatch[1];
    const blockEndRe = new RegExp(`(?:^|\\s)\\^${targetBlockId}\\s*$`);
    const lines = cleanBody.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      if (blockEndRe.test(lines[i])) {
        const cleanedTargetLine = lines[i].replace(blockEndRe, '').trimEnd();
        // If it's a list item or single line, collect contiguous paragraph/blockquote lines above it
        if (/^\s*(?:[-*+]|\d+\.)\s+/.test(cleanedTargetLine)) {
          return cleanedTargetLine.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim();
        }
        const blockLines: string[] = [cleanedTargetLine];
        let p = i - 1;
        while (
          p >= 0 &&
          lines[p].trim() !== '' &&
          !/^#{1,6}\s/.test(lines[p].trim()) &&
          !/^\s*(?:[-*+]|\d+\.)\s+/.test(lines[p].trim())
        ) {
          blockLines.unshift(lines[p]);
          p--;
        }
        return blockLines.join('\n').trim();
      }
    }
    return '';
  }

  // Case 2: Heading section reference (`Heading Name`)
  const targetSlug = normalizeId(trimmedAnchor);
  const lines = cleanBody.split(/\r?\n/);
  let capturing = false;
  let capturedLevel = 0;
  const out: string[] = [];

  for (const line of lines) {
    const hMatch = line.trimStart().match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const headingText = hMatch[2].trim();
      if (!capturing) {
        if (
          normalizeId(headingText) === targetSlug ||
          headingText.toLowerCase() === trimmedAnchor.toLowerCase()
        ) {
          capturing = true;
          capturedLevel = level;
          continue;
        }
      } else if (level <= capturedLevel) {
        break;
      }
    }
    if (capturing) {
      out.push(line);
    }
  }

  return out.join('\n').trim();
}

export interface LosslessSerializeOptions {
  originalRaw: string;
  title: string;
  scope: string;
  aliasesStr: string;
  tagsStr: string;
  sourcesStr: string;
  bodyContent: string;
  existingNote: NoteDocument;
}

/**
 * Reconstructs Markdown from structured editor fields with 100% lossless preservation
 * of custom Obsidian YAML properties (`cssclasses`, `created`, `author`, `publish`, custom lists)
 * and preserves whether the original file had YAML frontmatter or a leading `# H1` title.
 */
export function serializeMarkdownLossless(opts: LosslessSerializeOptions): string {
  const {
    originalRaw,
    title,
    scope,
    aliasesStr,
    tagsStr,
    sourcesStr,
    bodyContent,
    existingNote,
  } = opts;

  const cleanTitle = title.trim() || existingNote.title;
  const aliases = aliasesStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tags = tagsStr
    .split(',')
    .map((s) => s.trim().replace(/^#/, ''))
    .filter(Boolean);
  const sources = sourcesStr
    .split(/\r?\n|,/)
    .map((s) =>
      s
        .replace(/==\[AI(?::[^\]]+)?\]\s*([\s\S]*?)==/gi, '$1')
        .trim()
        .replace(/^["']|["']$/g, '')
    )
    .filter(Boolean);

  const normalizedOriginal = originalRaw.replace(/^\uFEFF/, '');
  const fmMatch = normalizedOriginal.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const hadOriginalFrontmatter = Boolean(fmMatch);
  const originalBody = fmMatch ? fmMatch[2] : normalizedOriginal;

  // Check if the original body had a leading `# H1` heading matching the old title
  const origBodyLines = originalBody.split(/\r?\n/);
  let firstNonEmptyIdx = 0;
  while (firstNonEmptyIdx < origBodyLines.length && !origBodyLines[firstNonEmptyIdx].trim()) {
    firstNonEmptyIdx++;
  }
  const firstLineMatch =
    firstNonEmptyIdx < origBodyLines.length
      ? origBodyLines[firstNonEmptyIdx].trim().match(/^#\s+(.+)$/)
      : null;
  const hadLeadingH1 = Boolean(firstLineMatch);

  const managedKeys = new Set([
    'title',
    'aliases',
    'alias',
    'tags',
    'tag',
    'ai_status',
    'status',
    'ai_source',
    'verified_at',
    'scope',
    'disambiguation',
    'sources',
    'source',
  ]);

  // Preserve custom YAML blocks (including custom multi-line lists and comments) in original order
  const customYamlBlocks: string[] = [];
  if (fmMatch) {
    const rawYamlLines = fmMatch[1].split(/\r?\n/);
    let skippingManagedList = false;

    for (const line of rawYamlLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#')) {
        customYamlBlocks.push(line);
        continue;
      }
      if (/^\s*-\s+/.test(line)) {
        if (!skippingManagedList) {
          customYamlBlocks.push(line);
        }
        continue;
      }
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
        if (managedKeys.has(key)) {
          skippingManagedList = true;
        } else {
          skippingManagedList = false;
          customYamlBlocks.push(line);
        }
      }
    }
  }

  const hasMetadataToWrite =
    hadOriginalFrontmatter ||
    cleanTitle !== existingNote.title ||
    aliases.length > 0 ||
    tags.length > 0 ||
    sources.length > 0 ||
    Boolean(scope.trim()) ||
    existingNote.epistemic_status !== 'verified' ||
    Boolean(existingNote.ai_source);

  const outLines: string[] = [];
  if (hasMetadataToWrite) {
    outLines.push('---');
    outLines.push(`title: ${cleanTitle}`);
    if (aliases.length > 0) {
      outLines.push(`aliases: [${aliases.join(', ')}]`);
    }
    if (tags.length > 0) {
      outLines.push(`tags: [${tags.join(', ')}]`);
    }
    if (
      hadOriginalFrontmatter ||
      existingNote.epistemic_status !== 'verified' ||
      existingNote.frontmatter.ai_status
    ) {
      outLines.push(`ai_status: ${existingNote.epistemic_status}`);
    }
    if (existingNote.ai_source) {
      outLines.push(`ai_source: ${existingNote.ai_source}`);
    }
    if (existingNote.verified_at) {
      outLines.push(`verified_at: ${existingNote.verified_at}`);
    }
    if (scope.trim()) {
      outLines.push(`scope: "${scope.trim().replace(/"/g, "'")}"`);
    }
    if (existingNote.frontmatter.disambiguation) {
      outLines.push(`disambiguation: "${existingNote.frontmatter.disambiguation}"`);
    }
    if (sources.length > 0) {
      outLines.push('sources:');
      for (const s of sources) {
        outLines.push(`  - "${s}"`);
      }
    }
    for (const customLine of customYamlBlocks) {
      outLines.push(customLine);
    }
    outLines.push('---');
    outLines.push('');
  }

  const trimmedBody = normalizeObsidianFormattedLinks(bodyContent.trimStart());
  if (trimmedBody.startsWith('# ')) {
    const firstNewline = trimmedBody.indexOf('\n');
    const rest = firstNewline !== -1 ? trimmedBody.slice(firstNewline + 1).trimStart() : '';
    outLines.push(`# ${cleanTitle}`);
    if (rest) {
      outLines.push('');
      outLines.push(rest);
    }
  } else if (hadLeadingH1) {
    outLines.push(`# ${cleanTitle}`);
    if (trimmedBody) {
      outLines.push('');
      outLines.push(trimmedBody);
    }
  } else {
    outLines.push(trimmedBody);
  }

  return outLines.join('\n');
}

export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, string>;
  aliases: string[];
  tags: string[];
  sources: string[];
  body: string;
} {
  const frontmatter: Record<string, string> = {};
  const aliases: string[] = [];
  const tags: string[] = [];
  const sources: string[] = [];

  const normalized = raw.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter, aliases, tags, sources, body: normalized };
  }

  const yamlStr = match[1];
  const body = match[2];
  let currentListKey: string | null = null;

  for (const line of yamlStr.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('- ')) {
      const item = stripAccidentalAiWrapper(
        trimmed
          .slice(2)
          .trim()
          .replace(/^["']|["']$/g, '')
      );
      if (item && currentListKey) {
        if (currentListKey === 'aliases' || currentListKey === 'alias') aliases.push(item);
        if (currentListKey === 'tags' || currentListKey === 'tag')
          tags.push(item.replace(/^#/, ''));
        if (currentListKey === 'sources' || currentListKey === 'source') sources.push(item);
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const val = trimmed.slice(colonIdx + 1).trim();
      if (!val) {
        currentListKey = key;
        continue;
      }
      currentListKey = null;

      if (val.startsWith('[') && val.endsWith(']')) {
        const items = val
          .slice(1, -1)
          .split(',')
          .map((s) => stripAccidentalAiWrapper(s.trim().replace(/^["']|["']$/g, '')))
          .filter(Boolean);
        if (key === 'aliases' || key === 'alias') aliases.push(...items);
        else if (key === 'tags' || key === 'tag')
          tags.push(...items.map((t) => t.replace(/^#/, '')));
        else if (key === 'sources' || key === 'source') sources.push(...items);
        else frontmatter[key] = val;
      } else {
        const cleanVal = stripAccidentalAiWrapper(val.replace(/^["']|["']$/g, ''));
        if (key === 'aliases' || key === 'alias') aliases.push(cleanVal);
        else if (key === 'tags' || key === 'tag') {
          for (const part of cleanVal.split(/[,\s]+/)) {
            const cleanTag = part.trim().replace(/^#/, '');
            if (cleanTag) tags.push(cleanTag);
          }
        } else if (key === 'sources' || key === 'source') {
          sources.push(cleanVal);
        }
        frontmatter[key] = cleanVal;
      }
    }
  }

  return { frontmatter, aliases, tags, sources, body };
}

export function parseAiSegments(body: string): AiSegment[] {
  const segments: AiSegment[] = [];
  const lines = body.split(/\r?\n/);
  const calloutHeaderRe = /^>\s*\[!(ai|ai-draft|ai-unverified)\](?:[+-])?\s*(.*)$/i;
  const inlineRe = /==\[AI(?::([^\]]+))?\]\s*(.+?)==/g;

  let i = 0;
  let segCounter = 1;

  while (i < lines.length) {
    const trimmed = lines[i].trimStart();
    const headerMatch = trimmed.match(calloutHeaderRe);
    if (headerMatch) {
      const startLine = i + 1;
      const sourceHint = headerMatch[2]?.trim() || null;
      const rawLines = [lines[i]];
      const contentLines: string[] = [];
      i++;
      while (i < lines.length) {
        const nextTrimmed = lines[i].trimStart();
        if (nextTrimmed.startsWith('>')) {
          rawLines.push(lines[i]);
          contentLines.push(nextTrimmed.replace(/^>\s?/, ''));
          i++;
        } else {
          break;
        }
      }
      segments.push({
        id: `ai-seg-${segCounter++}`,
        kind: 'callout',
        content: contentLines.join('\n').trim(),
        start_line: startLine,
        end_line: i,
        raw_match: rawLines.join('\n'),
        source_hint: sourceHint,
      });
      continue;
    }

    let match: RegExpExecArray | null;
    inlineRe.lastIndex = 0;
    while ((match = inlineRe.exec(lines[i])) !== null) {
      segments.push({
        id: `ai-seg-${segCounter++}`,
        kind: 'inline',
        content: match[2].trim(),
        start_line: i + 1,
        end_line: i + 1,
        raw_match: match[0],
        source_hint: match[1]?.trim() || null,
      });
    }

    i++;
  }

  return segments;
}

/**
 * Normalizes accidental formatting inside `[[...]]` (which is invalid in Obsidian because `*`
 * cannot be in a filename) into 100% Obsidian-compatible outer formatting:
 * - `[[**Target**]]` -> `**[[Target]]**`
 * - `[[*Target*]]` -> `*[[Target]]*`
 * - `[[Target|**Alias**]]` -> `**[[Target|Alias]]**`
 */
export function normalizeObsidianFormattedLinks(markdown: string): string {
  return markdown.replace(/(!?)\[\[([^\[\]\n]+)\]\]/g, (full, bang: string, inner: string) => {
    if (bang === '!') return full;
    const trimmed = inner.trim();
    // Case 1: Entire inner content wrapped in **...**
    const boldAll = trimmed.match(/^\*\*([^*]+)\*\*$/);
    if (boldAll) {
      return `**[[${boldAll[1].trim()}]]**`;
    }
    // Case 2: Entire inner content wrapped in *...*
    const italicAll = trimmed.match(/^\*([^*]+)\*$/);
    if (italicAll) {
      return `*[[${italicAll[1].trim()}]]*`;
    }
    // Case 3: Target|Alias where Target or Alias is wrapped in **...** or *...*
    if (trimmed.includes('|')) {
      const [rawTarget, rawAlias] = trimmed.split('|').map((s) => s.trim());
      const cleanTarget = rawTarget.replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
      const isBold =
        /^\*\*.*\*\*$/.test(rawTarget) || (rawAlias ? /^\*\*.*\*\*$/.test(rawAlias) : false);
      const isItalic =
        !isBold &&
        (/^\*.*\*$/.test(rawTarget) || (rawAlias ? /^\*.*\*$/.test(rawAlias) : false));
      const cleanAlias = rawAlias ? rawAlias.replace(/^\*{1,2}|\*{1,2}$/g, '').trim() : '';
      const coreLink = cleanAlias ? `[[${cleanTarget}|${cleanAlias}]]` : `[[${cleanTarget}]]`;
      if (isBold) return `**${coreLink}**`;
      if (isItalic) return `*${coreLink}*`;
    }
    return full;
  });
}

export function parseWikiLinks(body: string): WikiLinkRef[] {
  const links: WikiLinkRef[] = [];
  const cleanBody = stripObsidianComments(body);
  const lines = cleanBody.split(/\r?\n/);
  const linkRe = /(!?)\[\[([^\[\]]+)\]\]/g;

  lines.forEach((line, idx) => {
    let match: RegExpExecArray | null;
    linkRe.lastIndex = 0;
    while ((match = linkRe.exec(line)) !== null) {
      const isEmbed = match[1] === '!';
      const inner = match[2].trim();
      const raw = match[0];

      const [targetAndHeading, aliasPart] = inner.split('|').map((s) => s.trim());
      const [rawTarget, headingPart] = targetAndHeading.split('#').map((s) => s.trim());
      const targetRaw = rawTarget.replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
      const cleanAlias = aliasPart ? aliasPart.replace(/^\*{1,2}|\*{1,2}$/g, '').trim() : '';
      // Skip only if both targetRaw and headingPart are empty
      if (!targetRaw && !headingPart) continue;
      // Same-note anchor links like [[#Heading]] or [[#^block-id]] do not create outgoing cross-note links
      if (!targetRaw) continue;

      links.push({
        target: targetRaw,
        target_slug: normalizeId(targetRaw),
        display_text: cleanAlias || targetRaw,
        heading: headingPart || null,
        is_embed: isEmbed,
        line: idx + 1,
        context: stripMarkdownToPlainText(line),
        raw,
      });
    }
  });

  return links;
}

export function parseHeadings(body: string): HeadingRef[] {
  const out: HeadingRef[] = [];
  stripObsidianComments(body)
    .split(/\r?\n/)
    .forEach((line, idx) => {
      const m = line.trimStart().match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        out.push({
          level: m[1].length,
          text: m[2].trim(),
          line: idx + 1,
        });
      }
    });
  return out;
}

export function parseNote(relPath: string, rawMarkdown: string, updatedAt = '2026-11-05'): NoteDocument {
  const parts = relPath.split('/');
  const fileName = parts[parts.length - 1] || 'Untitled.md';
  const fileStem = fileName.replace(/\.md$/i, '');
  const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';

  const { frontmatter, aliases, tags, sources, body } = parseFrontmatter(rawMarkdown);
  const title = frontmatter.title || fileStem;
  const id = normalizeId(fileStem);

  const commentFreeBody = stripObsidianComments(body);
  const inlineTagRe = /(?:^|\s)#([a-zA-Z0-9_\-\u0E00-\u0E7F/]+)/g;
  for (const line of commentFreeBody.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line.trim())) continue;
    let m: RegExpExecArray | null;
    inlineTagRe.lastIndex = 0;
    while ((m = inlineTagRe.exec(line)) !== null) {
      if (!tags.includes(m[1])) tags.push(m[1]);
    }
  }

  const ai_segments = parseAiSegments(body);
  const outgoing_links = parseWikiLinks(body);
  const headings = parseHeadings(body);

  const fmStatus = (frontmatter.ai_status || frontmatter.status || '').toLowerCase();
  let epistemic_status: EpistemicStatus = 'verified';
  if (fmStatus === 'unverified' || fmStatus === 'ai-draft' || fmStatus === 'ai') {
    epistemic_status = 'unverified';
  } else if (ai_segments.length > 0 || tags.includes('ai-unverified') || tags.includes('ai-draft')) {
    epistemic_status = 'partial';
  }

  const word_count = body.trim() ? body.trim().split(/\s+/).length : 0;

  return {
    id,
    title,
    rel_path: relPath,
    folder,
    aliases,
    tags,
    frontmatter,
    body,
    raw_markdown: rawMarkdown,
    epistemic_status,
    ai_source: frontmatter.ai_source || null,
    verified_at: frontmatter.verified_at || null,
    sources,
    ai_segments,
    outgoing_links,
    headings,
    word_count,
    updated_at: updatedAt,
  };
}

export function updateFrontmatterStatus(
  rawMarkdown: string,
  newStatus: EpistemicStatus,
  verifiedDate?: string
): string {
  const normalized = rawMarkdown.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)(\r?\n---\r?\n?[\s\S]*)$/);
  if (match) {
    const yamlLines = match[1].split(/\r?\n/);
    const rest = match[2];
    let hasStatus = false;
    let hasVerifiedAt = false;

    const updatedLines = yamlLines.map((line) => {
      const t = line.trimStart();
      if (t.startsWith('ai_status:') || t.startsWith('status:')) {
        hasStatus = true;
        return `ai_status: ${newStatus}`;
      }
      if (t.startsWith('verified_at:') && verifiedDate) {
        hasVerifiedAt = true;
        return `verified_at: ${verifiedDate}`;
      }
      return line;
    });

    if (!hasStatus) updatedLines.push(`ai_status: ${newStatus}`);
    if (!hasVerifiedAt && verifiedDate) updatedLines.push(`verified_at: ${verifiedDate}`);

    return `---\n${updatedLines.join('\n')}${rest}`;
  }

  return `---\nai_status: ${newStatus}${
    verifiedDate ? `\nverified_at: ${verifiedDate}` : ''
  }\n---\n\n${normalized}`;
}

export function verifySegmentInMarkdown(
  rawMarkdown: string,
  segmentId: string,
  verifiedDate = '2026-11-05'
): string {
  const { body } = parseFrontmatter(rawMarkdown);
  const segments = parseAiSegments(body);
  const target = segments.find((s) => s.id === segmentId);
  if (!target) return rawMarkdown;

  const updated = rawMarkdown.replace(target.raw_match, target.content);
  const remaining = parseAiSegments(parseFrontmatter(updated).body);
  return remaining.length === 0
    ? updateFrontmatterStatus(updated, 'verified', verifiedDate)
    : updateFrontmatterStatus(updated, 'partial');
}

export function verifyEntireMarkdown(rawMarkdown: string, verifiedDate = '2026-11-05'): string {
  let current = rawMarkdown;
  while (true) {
    const segments = parseAiSegments(parseFrontmatter(current).body);
    if (segments.length === 0) break;
    current = current.replace(segments[0].raw_match, segments[0].content);
  }
  return updateFrontmatterStatus(current, 'verified', verifiedDate);
}

export function findUnlinkedPosition(line: string, term: string): number {
  if (!term || !line.includes(term)) return -1;
  const ranges: Array<[number, number]> = [];
  const re =
    /!?\[\[[^\[\]]+\]\]|(%%[\s\S]*?%%)|(==\[AI(?::[^\]]+)?\]\s*.+?==)|(`[^`]+`)|(https?:\/\/\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  let searchFrom = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf(term, searchFrom);
    if (idx === -1) break;
    const end = idx + term.length;
    const insideProtected = ranges.some(([s, e]) => idx < e && end > s);
    if (!insideProtected) return idx;
    searchFrom = idx + 1;
  }
  return -1;
}

/**
 * Strips any accidental UI button or badge text that may have been captured
 * by window.getSelection() when dragging across rendered prose.
 */
export function sanitizeBrowserSelectionForAi(rawSelection: string): string {
  return rawSelection
    .replace(/\[AI(?::[^\]]+)?\]/gi, '')
    .replace(/\b(?:Verify|×\s*Unmark\s*AI|Unmark\s*AI|Connect\s*Hypha)\b/gi, '')
    .replace(/^[\s•·|>-]+|[\s•·|>-]+$/g, '')
    .trim();
}

/**
 * Finds a safe prose substring match on a single Markdown line outside of:
 * - WikiLinks [[...]] and Embeds ![[...]]
 * - Obsidian comments %%...%%
 * - Existing AI spans ==[AI...] ...== and highlights ==...==
 * - Inline code `...`, LaTeX $...$, Markdown links [...](...), and raw URLs
 */
export function findSafeProsePosition(line: string, target: string): number {
  if (!target || !line.includes(target)) return -1;
  const protectedRanges: Array<[number, number]> = [];
  const tokenRe =
    /(!?\[\[[^\[\]]+\]\])|(%%[\s\S]*?%%)|(!?\[[^\]]*\]\([^)]+\))|(==\[AI(?::[^\]]+)?\]\s*.+?==)|(==[^=\n]+==)|(`[^`\n]+`)|(\$\$[^$]+\$\$|\$[^$\n]+\$)|(https?:\/\/\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(line)) !== null) {
    protectedRanges.push([m.index, m.index + m[0].length]);
  }

  let searchFrom = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf(target, searchFrom);
    if (idx === -1) break;
    const end = idx + target.length;
    const overlapsProtected = protectedRanges.some(([s, e]) => idx < e && end > s);
    if (!overlapsProtected) {
      return idx;
    }
    searchFrom = idx + 1;
  }
  return -1;
}

/**
 * Safely wraps a user's selected prose in `==[AI:manual] ...==` without ever corrupting
 * YAML frontmatter, headings, WikiLinks `[[...]]`, embeds `![[...]]`, URLs, code blocks,
 * Obsidian comments `%%...%%`, or existing AI spans.
 */
export function markSelectionAsAiSafely(
  rawMarkdown: string,
  selectedText: string,
  sourceTag = 'manual'
): string {
  const cleanedSelection = sanitizeBrowserSelectionForAi(selectedText);
  if (cleanedSelection.length < 2) return rawMarkdown;

  const { body } = parseFrontmatter(rawMarkdown);
  const headerLen = rawMarkdown.length - body.length;
  const header = rawMarkdown.slice(0, headerLen);

  // Split multi-line selections into individual safe single-line fragments
  const selectionLines = cleanedSelection
    .split(/\r?\n/)
    .map((s) => sanitizeBrowserSelectionForAi(s))
    .filter((s) => s.length >= 2);
  if (selectionLines.length === 0) return rawMarkdown;

  const lines = body.split('\n');
  let inCodeFence = false;
  let inMathBlock = false;
  let inCommentBlock = false;
  let modifiedCount = 0;

  for (const selFragment of selectionLines) {
    let matchedThisFragment = false;

    // Pass 1: Exact safe prose substring outside protected Markdown tokens
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (trimmed.startsWith('$$') && trimmed === '$$') {
        inMathBlock = !inMathBlock;
        continue;
      }
      if (trimmed === '%%') {
        inCommentBlock = !inCommentBlock;
        continue;
      }
      if (inCodeFence || inMathBlock || inCommentBlock) continue;
      if (
        !trimmed ||
        /^#{1,6}\s/.test(trimmed) ||
        /^>\s*\[!/.test(trimmed) ||
        /^\|[\s:|-]+\|$/.test(trimmed) ||
        /^\[\^[^\]]+\]:/.test(trimmed)
      ) {
        continue;
      }

      const pos = findSafeProsePosition(line, selFragment);
      if (pos !== -1) {
        lines[i] =
          line.slice(0, pos) +
          `==[AI:${sourceTag}] ${selFragment}==` +
          line.slice(pos + selFragment.length);
        modifiedCount++;
        matchedThisFragment = true;
        break;
      }
    }

    // Pass 2: If the selection crossed rendered inline formatting (e.g. [[Target|Alias]] or **bold**),
    // locate the prose line whose plain-text rendering contains selFragment and wrap the safe text outside [[...]]
    if (!matchedThisFragment) {
      inCodeFence = false;
      inMathBlock = false;
      inCommentBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed.startsWith('```')) {
          inCodeFence = !inCodeFence;
          continue;
        }
        if (trimmed === '%%') {
          inCommentBlock = !inCommentBlock;
          continue;
        }
        if (inCodeFence || inMathBlock || inCommentBlock) continue;
        if (
          !trimmed ||
          /^#{1,6}\s/.test(trimmed) ||
          /^>\s*\[!/.test(trimmed) ||
          trimmed.includes('==[AI')
        ) {
          continue;
        }
        const plainLine = stripMarkdownToPlainText(stripObsidianComments(line));
        if (plainLine.includes(selFragment) && !/^[-*]\s+\[[ xX]\]/.test(trimmed)) {
          const listPrefixMatch = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)(.+)$/);
          if (listPrefixMatch) {
            lines[i] = `${listPrefixMatch[1]}==[AI:${sourceTag}] ${listPrefixMatch[2].trim()}==`;
          } else {
            lines[i] = `==[AI:${sourceTag}] ${trimmed}==`;
          }
          modifiedCount++;
          break;
        }
      }
    }
  }

  if (modifiedCount === 0) return rawMarkdown;
  const nextRaw = header + lines.join('\n');
  return updateFrontmatterStatus(nextRaw, 'partial');
}

/**
 * Safely removes an inline `==[AI...] ...==` wrapper matching `targetTextOrRawMatch`
 * (only within the Markdown body) and updates `ai_status` in YAML frontmatter.
 */
export function unmarkAiSpanSafely(
  rawMarkdown: string,
  targetTextOrRawMatch: string,
  verifiedDate = '2026-11-05'
): string {
  const { body } = parseFrontmatter(rawMarkdown);
  const headerLen = rawMarkdown.length - body.length;
  const header = rawMarkdown.slice(0, headerLen);

  let updatedBody = body;
  if (targetTextOrRawMatch.startsWith('==[AI') && body.includes(targetTextOrRawMatch)) {
    const inner = targetTextOrRawMatch
      .replace(/^==\[AI(?::[^\]]+)?\]\s*/i, '')
      .replace(/==$/, '');
    updatedBody = body.replace(targetTextOrRawMatch, inner);
  } else {
    const cleaned = sanitizeBrowserSelectionForAi(targetTextOrRawMatch);
    if (cleaned) {
      const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const exactRe = new RegExp(`==\\[AI(?::[^\\]]+)?\\]\\s*(${escaped})==`);
      if (exactRe.test(body)) {
        updatedBody = body.replace(exactRe, '$1');
      } else {
        // Fallback: if user selected a substring inside an AI span, unwrap that AI span
        updatedBody = body.replace(/==\[AI(?::[^\]]+)?\]\s*(.+?)==/g, (full, innerText) =>
          innerText.includes(cleaned) ? innerText : full
        );
      }
    }
  }

  if (updatedBody === body) return rawMarkdown;
  const nextRaw = header + updatedBody;
  const remaining = parseAiSegments(parseFrontmatter(nextRaw).body);
  return remaining.length === 0
    ? updateFrontmatterStatus(nextRaw, 'verified', verifiedDate)
    : updateFrontmatterStatus(nextRaw, 'partial');
}

export function linkTermInMarkdown(rawMarkdown: string, term: string, targetTitle: string): string {
  const cleanTerm = term.replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
  const cleanTarget = targetTitle.replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
  if (!cleanTerm || !cleanTarget) return rawMarkdown;
  const { body } = parseFrontmatter(rawMarkdown);
  const headerLen = rawMarkdown.length - body.length;
  const header = rawMarkdown.slice(0, headerLen);

  const replacement =
    cleanTerm.toLowerCase() === cleanTarget.toLowerCase()
      ? `[[${cleanTarget}]]`
      : `[[${cleanTarget}|${cleanTerm}]]`;

  let replaced = false;
  let inCommentBlock = false;
  const updatedLines = body.split('\n').map((line) => {
    const trimmed = line.trim();
    if (trimmed === '%%') {
      inCommentBlock = !inCommentBlock;
      return line;
    }
    if (replaced || inCommentBlock || line.trimStart().startsWith('#')) return line;
    const pos = findUnlinkedPosition(line, cleanTerm);
    if (pos !== -1) {
      replaced = true;
      return normalizeObsidianFormattedLinks(
        line.slice(0, pos) + replacement + line.slice(pos + cleanTerm.length)
      );
    }
    return line;
  });

  return header + updatedLines.join('\n');
}

export function buildVaultSnapshot(
  rawFiles: Array<{ relPath: string; rawMarkdown: string }>,
  vaultPath = '/Users/jayjetsada/Project/Mycelium/sample-vault',
  verificationLog: VerificationAuditEntry[] = []
): VaultSnapshot {
  const notes = rawFiles
    .map((f) => parseNote(f.relPath, f.rawMarkdown))
    .sort((a, b) => a.title.localeCompare(b.title));

  const termToNote = new Map<string, { id: string; title: string }>();
  for (const n of notes) {
    termToNote.set(normalizeId(n.title), { id: n.id, title: n.title });
    termToNote.set(n.id, { id: n.id, title: n.title });
    const relPathSlug = normalizeId(n.rel_path);
    if (relPathSlug) {
      termToNote.set(relPathSlug, { id: n.id, title: n.title });
    }
    // Also index trailing stem of path-qualified links
    const stemPart = n.rel_path.split('/').pop() || '';
    const stemSlug = normalizeId(stemPart);
    if (stemSlug) {
      termToNote.set(stemSlug, { id: n.id, title: n.title });
    }
    for (const a of n.aliases) {
      const slug = normalizeId(a);
      if (slug) termToNote.set(slug, { id: n.id, title: n.title });
    }
  }

  const backlinks: Record<string, BacklinkRef[]> = {};
  const graphEdges: GraphEdge[] = [];
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const stubNodes = new Map<string, string>();

  for (const note of notes) {
    if (!backlinks[note.id]) backlinks[note.id] = [];
    const seenTargets = new Set<string>();

    for (const link of note.outgoing_links) {
      const stemFallbackSlug = normalizeId(link.target.split('/').pop() || link.target);
      const resolved =
        termToNote.get(link.target_slug) || termToNote.get(stemFallbackSlug);
      const targetId = resolved ? resolved.id : link.target_slug;
      if (!resolved) {
        stubNodes.set(link.target_slug, link.target);
      }
      if (targetId === note.id) continue;

      if (!backlinks[targetId]) backlinks[targetId] = [];
      backlinks[targetId].push({
        source_id: note.id,
        source_title: note.title,
        source_path: note.rel_path,
        line: link.line,
        context: link.context,
        display_text: link.display_text,
      });

      if (!seenTargets.has(targetId)) {
        seenTargets.add(targetId);
        outDegree.set(note.id, (outDegree.get(note.id) || 0) + 1);
        inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
        graphEdges.push({
          source: note.id,
          target: targetId,
          label: link.display_text !== link.target ? link.display_text : null,
        });
      }
    }
  }

  const unlinked_mentions: Record<string, UnlinkedMention[]> = {};
  for (const targetNote of notes) {
    const terms = [targetNote.title, ...targetNote.aliases].filter((t) => t.trim().length >= 2);
    const list: UnlinkedMention[] = [];

    for (const sourceNote of notes) {
      if (sourceNote.id === targetNote.id) continue;
      const { body } = parseFrontmatter(sourceNote.raw_markdown);
      const commentFreeBody = stripObsidianComments(body);
      commentFreeBody.split(/\r?\n/).forEach((line, lineIdx) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        for (const term of terms) {
          if (findUnlinkedPosition(line, term) !== -1) {
            list.push({
              source_id: sourceNote.id,
              source_title: sourceNote.title,
              target_id: targetNote.id,
              target_title: targetNote.title,
              matched_term: term,
              line: lineIdx + 1,
              context: stripMarkdownToPlainText(trimmed),
            });
            break;
          }
        }
      });
    }
    unlinked_mentions[targetNote.id] = list;
  }

  const graph_nodes: GraphNode[] = notes.map((n) => ({
    id: n.id,
    title: n.title,
    folder: n.folder,
    tags: n.tags,
    epistemic_status: n.epistemic_status,
    ai_segment_count: n.ai_segments.length,
    is_stub: false,
    in_degree: inDegree.get(n.id) || 0,
    out_degree: outDegree.get(n.id) || 0,
  }));

  for (const [stubId, stubTitle] of stubNodes.entries()) {
    graph_nodes.push({
      id: stubId,
      title: stubTitle,
      folder: '',
      tags: ['stub'],
      epistemic_status: 'verified',
      ai_segment_count: 0,
      is_stub: true,
      in_degree: inDegree.get(stubId) || 0,
      out_degree: 0,
    });
  }

  return {
    vault_path: vaultPath,
    notes,
    backlinks,
    unlinked_mentions,
    graph_nodes,
    graph_edges: graphEdges,
    verification_log: verificationLog,
  };
}
