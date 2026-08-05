import type { OrderedListMode } from '../types';
import {
  isMarkdownTableSeparatorLine,
  isPotentialMarkdownTableRow,
  normalizeMarkdownTableSeparatorLine,
  preprocessMarkdownTableLines,
} from './markdownTableNormalize';

const MARKDOWN_FILE_REGEX = /\.(md|markdown)$/i;
const FENCE_MARKER_REGEX = /^(\s*)(`{3,}|~{3,})/;
const CJK_CHARACTER = '\\p{Script=Han}';
const ASCII_WORD = '[A-Za-z0-9]+(?:[A-Za-z0-9._+-]*[A-Za-z0-9]+)?';
const INLINE_MARKER = '[_*~]+';
const PROTECTED_TOKEN_PREFIX = '\uE000';
const PROTECTED_TOKEN_SUFFIX = '\uE001';

type MarkdownLineKind =
  | 'blank'
  | 'paragraph'
  | 'heading'
  | 'headingUnderline'
  | 'thematicBreak'
  | 'list'
  | 'blockquote'
  | 'indentedCode'
  | 'table'
  | 'htmlComment'
  | 'linkDefinition'
  | 'footnoteDefinition';

interface MarkdownFormatOptions {
  orderedListMode?: OrderedListMode;
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\n[\s\S]*?\n---(?:\n|$)/);
  if (!match) {
    return { frontmatter: '', body: content };
  }

  return {
    frontmatter: match[0].trimEnd(),
    body: content.slice(match[0].length),
  };
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === '') {
    start += 1;
  }

  while (end > start && lines[end - 1].trim() === '') {
    end -= 1;
  }

  return lines.slice(start, end);
}

function protectInlineCode(line: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  let result = '';
  let cursor = 0;

  while (cursor < line.length) {
    const markerStart = line.indexOf('`', cursor);
    if (markerStart === -1) {
      result += line.slice(cursor);
      break;
    }

    result += line.slice(cursor, markerStart);

    let markerEnd = markerStart;
    while (markerEnd < line.length && line[markerEnd] === '`') {
      markerEnd += 1;
    }

    const marker = line.slice(markerStart, markerEnd);
    const closingIndex = line.indexOf(marker, markerEnd);
    if (closingIndex === -1) {
      result += marker;
      cursor = markerEnd;
      continue;
    }

    const protectedToken = line.slice(markerStart, closingIndex + marker.length);
    const placeholder = `${PROTECTED_TOKEN_PREFIX}${tokens.length}${PROTECTED_TOKEN_SUFFIX}`;
    tokens.push(protectedToken);
    result += placeholder;
    cursor = closingIndex + marker.length;
  }

  return { text: result, tokens };
}

function protectPattern(line: string, tokens: string[], pattern: RegExp): string {
  return line.replace(pattern, (match) => {
    const placeholder = `${PROTECTED_TOKEN_PREFIX}${tokens.length}${PROTECTED_TOKEN_SUFFIX}`;
    tokens.push(match);
    return placeholder;
  });
}

function protectMarkdownSyntax(line: string): { text: string; tokens: string[] } {
  const inlineCodeProtected = protectInlineCode(line);
  let text = inlineCodeProtected.text;
  const tokens = [...inlineCodeProtected.tokens];

  text = protectPattern(text, tokens, /!?\[\[[^\]\n]+\]\]/g);
  text = protectPattern(text, tokens, /!?\[[^\]\n]*\]\([^) \n][^)\n]*\)/g);
  text = protectPattern(text, tokens, /<[^>\n]+>/g);

  return { text, tokens };
}

function restoreMarkdownSyntax(line: string, tokens: string[]): string {
  return line.replace(/\uE000(\d+)\uE001/g, (_, index) => tokens[Number(index)] ?? '');
}

function applyChineseEnglishSpacing(line: string): string {
  const { text, tokens } = protectMarkdownSyntax(line);
  const cjkToAscii = new RegExp(`(${CJK_CHARACTER})(${ASCII_WORD})`, 'gu');
  const asciiToCjk = new RegExp(`(${ASCII_WORD})(${CJK_CHARACTER})`, 'gu');
  const cjkToMarkerAscii = new RegExp(`(${CJK_CHARACTER})(${INLINE_MARKER})(${ASCII_WORD})`, 'gu');
  const asciiMarkerToCjk = new RegExp(`(${ASCII_WORD})(${INLINE_MARKER})(${CJK_CHARACTER})`, 'gu');

  const spaced = text
    .replace(cjkToMarkerAscii, '$1 $2$3')
    .replace(asciiMarkerToCjk, '$1$2 $3')
    .replace(cjkToAscii, '$1 $2')
    .replace(asciiToCjk, '$1 $2');

  return restoreMarkdownSyntax(spaced, tokens);
}

function isAtxHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/.test(line);
}

function isSetextHeadingUnderline(line: string): boolean {
  return /^\s{0,3}(?:=+|-+)\s*$/.test(line);
}

function isThematicBreak(line: string): boolean {
  return /^\s{0,3}(?:(?:-\s*){3,}|(?:_\s*){3,}|(?:\*\s*){3,})$/.test(line);
}

function isListItem(line: string, previousNonBlankKind: MarkdownLineKind | null = null): boolean {
  const match = line.match(/^(\s*)(?:[-+*](?:\s+\S|\s*$)|\d+[.)](?:\s+\S|[A-Za-z\u4e00-\u9fff].*|\s*$))/);
  if (!match) return false;

  const indent = match[1];
  if (indent.length <= 3) return true;

  return previousNonBlankKind === 'list';
}

function isBlockquote(line: string): boolean {
  return /^\s{0,3}>\s?/.test(line);
}

function isListIntroductionLine(line: string): boolean {
  return /[:：]\s*$/.test(line.trimEnd());
}

function isIndentedCode(line: string): boolean {
  return /^(?: {4,}|\t)/.test(line);
}

/** One CommonMark indent unit for indented code blocks (4 spaces or one tab). */
function stripOneLeadingIndent(line: string): string {
  if (line.startsWith('\t')) return line.slice(1);
  if (line.startsWith('    ')) return line.slice(4);
  return line;
}

/**
 * Lines with a 4-space/tab prefix are parsed as indented code blocks. Pasted snippets often
 * only indent the inner lines; strip one indent level when such a line is "orphaned" between
 * non-indented lines so it stays ordinary paragraph text after format-on-save.
 */
function unwrapOrphanIndentedCodeLines(lines: string[]): string[] {
  if (lines.length === 0) return lines;

  const kinds: MarkdownLineKind[] = [];
  let previousNonBlankLine: string | null = null;
  let previousNonBlankKind: MarkdownLineKind | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const kind = classifyMarkdownLine(lines[i], previousNonBlankLine, previousNonBlankKind);
    kinds[i] = kind;
    if (kind !== 'blank') {
      previousNonBlankLine = lines[i];
      previousNonBlankKind = kind;
    }
  }

  const prevNonBlankIndex = (index: number): number | null => {
    for (let j = index - 1; j >= 0; j -= 1) {
      if (lines[j].trim() !== '') return j;
    }
    return null;
  };

  const nextNonBlankIndex = (index: number): number | null => {
    for (let j = index + 1; j < lines.length; j += 1) {
      if (lines[j].trim() !== '') return j;
    }
    return null;
  };

  return lines.map((line, i) => {
    const kind = kinds[i];
    if (kind !== 'indentedCode') return line;

    const pi = prevNonBlankIndex(i);
    const ni = nextNonBlankIndex(i);
    const prevKind = pi === null ? null : kinds[pi];
    const nextKind = ni === null ? null : kinds[ni];

    if (prevKind !== 'indentedCode' && nextKind !== 'indentedCode') {
      return stripOneLeadingIndent(line);
    }
    return line;
  });
}

function isHtmlCommentLine(line: string): boolean {
  return /^\s*<!--.*-->\s*$/.test(line);
}

function isLinkDefinition(line: string): boolean {
  return /^\s{0,3}\[[^\]\n]+\]:\s*\S/.test(line);
}

function isFootnoteDefinition(line: string): boolean {
  return /^\s{0,3}\[\^[^\]\n]+\]:\s*\S?/.test(line);
}


function normalizeAtxHeading(line: string): string {
  const match = line.match(/^(\s{0,3})(#{1,6})\s*(.*?)\s*(?:#+\s*)?$/);
  if (!match) return line;

  const [, indent, hashes, rawContent] = match;
  const content = rawContent.trim();
  return content ? `${indent}${hashes} ${content}` : `${indent}${hashes}`;
}

function normalizeUnorderedList(line: string): string {
  return line.replace(/^(\s{0,3})[-+*](?:\s+|$)/, '$1- ');
}

function normalizeOrderedList(line: string): string {
  const match = line.match(/^(\s*)(\d+)[\.)](?:\s+(.*)|([A-Za-z\u4e00-\u9fff].*))?$/);
  if (!match) return line;

  const [, indent, number, spacedContent = '', tightContent = ''] = match;
  const content = (spacedContent || tightContent).trimStart();
  return content ? `${indent}${number}. ${content}` : `${indent}${number}.`;
}

function normalizeTaskList(line: string): string {
  return line.replace(/^(\s{0,3})-\s+\[([ xX])\]\s+/, (_, indent: string, checked: string) => {
    const marker = checked.toLowerCase() === 'x' ? 'x' : ' ';
    return `${indent}- [${marker}] `;
  });
}

function normalizeBlockquote(line: string): string {
  const match = line.match(/^(\s{0,3})(>+)(.*)$/);
  if (!match) return line;

  const [, indent, markers, rest] = match;
  const normalizedRest = rest.trimStart();
  return normalizedRest ? `${indent}${markers} ${normalizedRest}` : `${indent}${markers}`;
}

function normalizeThematicBreak(line: string): string {
  const indent = line.match(/^(\s{0,3})/)?.[1] ?? '';
  return `${indent}---`;
}

function normalizeLinkDefinition(line: string): string {
  return line.replace(/^(\s{0,3}\[[^\]\n]+\]:)\s*/, '$1 ');
}

function normalizeFootnoteDefinition(line: string): string {
  return line.replace(/^(\s{0,3}\[\^[^\]\n]+\]:)\s*/, '$1 ');
}

function getOrderedListInfo(line: string): { indentLength: number; number: number } | null {
  const match = line.match(/^(\s*)(\d+)[\.)](?:\s+.*|[A-Za-z\u4e00-\u9fff].*|$)/);
  if (!match) return null;
  return {
    indentLength: match[1].length,
    number: Number(match[2]),
  };
}

function getBlockquoteOrderedListInfo(line: string): {
  prefix: string;
  indentLength: number;
  number: number;
} | null {
  const match = line.match(/^(\s{0,3}>+\s?)(\s*)(\d+)[\.)](?:\s+.*|[A-Za-z\u4e00-\u9fff].*|$)/);
  if (!match) return null;
  return {
    prefix: match[1],
    indentLength: match[2].length,
    number: Number(match[3]),
  };
}

function isTableLine(line: string, previousNonBlankLine: string | null): boolean {
  if (isMarkdownTableSeparatorLine(line)) {
    return Boolean(previousNonBlankLine && isPotentialMarkdownTableRow(previousNonBlankLine));
  }

  if (!isPotentialMarkdownTableRow(line)) {
    return false;
  }

  return Boolean(
    previousNonBlankLine &&
      (isMarkdownTableSeparatorLine(previousNonBlankLine) || isPotentialMarkdownTableRow(previousNonBlankLine)),
  );
}

function classifyMarkdownLine(
  line: string,
  previousNonBlankLine: string | null,
  previousNonBlankKind: MarkdownLineKind | null = null,
): MarkdownLineKind {
  if (line.trim() === '') return 'blank';
  if (isHtmlCommentLine(line)) return 'htmlComment';
  if (isFootnoteDefinition(line)) return 'footnoteDefinition';
  if (isLinkDefinition(line)) return 'linkDefinition';
  if (
    previousNonBlankLine &&
    isSetextHeadingUnderline(line) &&
    !isAtxHeading(previousNonBlankLine) &&
    !isThematicBreak(previousNonBlankLine) &&
    previousNonBlankKind !== 'list' &&
    !isBlockquote(previousNonBlankLine) &&
    !isIndentedCode(previousNonBlankLine)
  ) {
    return 'headingUnderline';
  }
  if (isAtxHeading(line)) return 'heading';
  if (isThematicBreak(line)) return 'thematicBreak';
  if (isTableLine(line, previousNonBlankLine)) return 'table';
  if (isListItem(line, previousNonBlankKind)) return 'list';
  if (isBlockquote(line)) return 'blockquote';
  if (isIndentedCode(line)) return 'indentedCode';
  return 'paragraph';
}

function shouldInsertBlankLineBetween(
  previousKind: MarkdownLineKind,
  currentKind: MarkdownLineKind,
  previousNonBlankLine: string | null,
  currentLine: string,
): boolean {
  if (previousKind === 'blank' || currentKind === 'blank') {
    return false;
  }

  if (
    currentKind === 'table' &&
    previousKind === 'paragraph' &&
    previousNonBlankLine &&
    isPotentialMarkdownTableRow(previousNonBlankLine) &&
    isMarkdownTableSeparatorLine(currentLine)
  ) {
    return false;
  }

  if (previousKind === 'heading' || previousKind === 'headingUnderline') {
    return true;
  }

  if (currentKind === 'heading' || currentKind === 'thematicBreak') {
    return true;
  }

  if (previousKind === 'thematicBreak') {
    return true;
  }

  if (previousKind === 'list' && currentKind !== 'list') {
    return true;
  }

  if (
    previousKind === 'paragraph' &&
    currentKind === 'list' &&
    previousNonBlankLine &&
    isListIntroductionLine(previousNonBlankLine)
  ) {
    return false;
  }

  if (currentKind === 'list' && previousKind !== 'list') {
    return true;
  }

  if (previousKind === 'table' && currentKind !== 'table') {
    return true;
  }

  if (currentKind === 'table' && previousKind !== 'table') {
    return true;
  }

  if (previousKind === 'blockquote' && currentKind !== 'blockquote') {
    return true;
  }

  if (currentKind === 'blockquote' && previousKind !== 'blockquote') {
    return true;
  }

  if (previousKind === 'indentedCode' && currentKind !== 'indentedCode') {
    return true;
  }

  if (currentKind === 'indentedCode' && previousKind !== 'indentedCode') {
    return true;
  }

  if (previousKind === 'htmlComment' || currentKind === 'htmlComment') {
    return true;
  }

  if (previousKind === 'linkDefinition' && currentKind !== 'linkDefinition') {
    return true;
  }

  if (currentKind === 'linkDefinition' && previousKind !== 'linkDefinition') {
    return true;
  }

  if (previousKind === 'footnoteDefinition' && currentKind !== 'footnoteDefinition') {
    return true;
  }

  if (currentKind === 'footnoteDefinition' && previousKind !== 'footnoteDefinition') {
    return true;
  }

  return false;
}

function normalizeOrderedCounterKey(prefix: string, indentLength: number): string {
  return `${prefix}:${indentLength}`;
}

function pruneDeeperOrderedCounters(
  counters: Map<string, number>,
  prefix: string,
  indentLength: number,
): void {
  const keyPrefix = `${prefix}:`;
  for (const key of [...counters.keys()]) {
    if (!key.startsWith(keyPrefix)) continue;
    const keyIndentLength = Number(key.slice(keyPrefix.length));
    if (keyIndentLength > indentLength) {
      counters.delete(key);
    }
  }
}

function nextOrderedNumber(
  counters: Map<string, number>,
  prefix: string,
  indentLength: number,
): number {
  const key = normalizeOrderedCounterKey(prefix, indentLength);
  const nextNumber = (counters.get(key) ?? 0) + 1;
  counters.set(key, nextNumber);
  return nextNumber;
}

function renumberOrderedListLine(line: string, nextNumber: number): string {
  const normalized = normalizeOrderedList(line);
  const match = normalized.match(/^(\s*)\d+\.\s*(.*)$/);
  if (!match) return normalized;

  const [, indent, content] = match;
  return content ? `${indent}${nextNumber}. ${content}` : `${indent}${nextNumber}.`;
}

function renumberBlockquoteOrderedListLine(line: string, nextNumber: number): string {
  const normalized = normalizeBlockquote(line);
  const match = normalized.match(/^(\s{0,3}>+\s?\s*)\d+[.)](?:\s+(.*)|([A-Za-z\u4e00-\u9fff].*))?$/);
  if (!match) return normalized;

  const [, prefix, spacedContent = '', tightContent = ''] = match;
  const content = (spacedContent || tightContent).trimStart();
  return content ? `${prefix}${nextNumber}. ${content}` : `${prefix}${nextNumber}.`;
}

function normalizeMarkdownLine(
  line: string,
  kind: MarkdownLineKind,
  orderedListCounters: Map<string, number>,
  orderedListMode: OrderedListMode
): string {
  switch (kind) {
    case 'heading':
      return normalizeAtxHeading(line);
    case 'thematicBreak':
      return normalizeThematicBreak(line);
    case 'list': {
      const orderedInfo = getOrderedListInfo(line);
      if (orderedInfo) {
        const normalized = normalizeOrderedList(line);

        if (orderedListMode !== 'strict') {
          return normalized;
        }

        pruneDeeperOrderedCounters(orderedListCounters, 'root', orderedInfo.indentLength);
        const nextNumber = nextOrderedNumber(orderedListCounters, 'root', orderedInfo.indentLength);
        return renumberOrderedListLine(normalized, nextNumber);
      }

      orderedListCounters.clear();
      return normalizeTaskList(normalizeUnorderedList(line));
    }
    case 'blockquote':
      {
        const blockquoteOrderedInfo = getBlockquoteOrderedListInfo(line);
        if (!blockquoteOrderedInfo || orderedListMode !== 'strict') {
          return normalizeBlockquote(line);
        }

        const counterPrefix = `quote:${blockquoteOrderedInfo.prefix}`;
        pruneDeeperOrderedCounters(orderedListCounters, counterPrefix, blockquoteOrderedInfo.indentLength);
        const nextNumber = nextOrderedNumber(
          orderedListCounters,
          counterPrefix,
          blockquoteOrderedInfo.indentLength,
        );
        return renumberBlockquoteOrderedListLine(line, nextNumber);
      }
    case 'linkDefinition':
      orderedListCounters.clear();
      return normalizeLinkDefinition(line);
    case 'footnoteDefinition':
      orderedListCounters.clear();
      return normalizeFootnoteDefinition(line);
    case 'table':
      orderedListCounters.clear();
      return normalizeMarkdownTableSeparatorLine(line);
    default:
      orderedListCounters.clear();
      return line;
  }
}

function isBlankBeforeIntroducedList(
  lines: string[],
  index: number,
  previousKind: MarkdownLineKind,
  previousNonBlankLine: string | null,
): boolean {
  if (
    previousKind !== 'paragraph' ||
    !previousNonBlankLine ||
    !isListIntroductionLine(previousNonBlankLine)
  ) {
    return false;
  }

  for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
    if (lines[nextIndex].trim() === '') continue;
    return classifyMarkdownLine(lines[nextIndex], previousNonBlankLine, previousKind) === 'list';
  }

  return false;
}

function normalizeBlockSpacing(lines: string[], options: MarkdownFormatOptions): string[] {
  const output: string[] = [];
  let previousNonBlankLine: string | null = null;
  let previousKind: MarkdownLineKind = 'blank';
  const orderedListCounters = new Map<string, number>();
  let deferredBlankAfterTable = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const currentKind = classifyMarkdownLine(line, previousNonBlankLine, previousKind);

    if (currentKind === 'blank') {
      if (isBlankBeforeIntroducedList(lines, index, previousKind, previousNonBlankLine)) {
        orderedListCounters.clear();
        continue;
      }
      if (previousKind === 'table') {
        deferredBlankAfterTable = true;
        orderedListCounters.clear();
        continue;
      }
      deferredBlankAfterTable = false;
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      orderedListCounters.clear();
      continue;
    }

    if (deferredBlankAfterTable) {
      deferredBlankAfterTable = false;
      // Table-to-table: blank dropped. Table-to-non-table: boundary blank from shouldInsert below.
    }

    if (
      shouldInsertBlankLineBetween(previousKind, currentKind, previousNonBlankLine, line) &&
      output[output.length - 1] !== ''
    ) {
      output.push('');
    }

    const normalizedLine = normalizeMarkdownLine(
      line,
      currentKind,
      orderedListCounters,
      options.orderedListMode ?? 'strict'
    );
    output.push(normalizedLine);
    previousNonBlankLine = normalizedLine;
    previousKind = currentKind;
  }

  return trimOuterBlankLines(output);
}

function formatTextSegment(segment: string, options: MarkdownFormatOptions): string {
  const normalizedLines = unwrapOrphanIndentedCodeLines(trimOuterBlankLines(segment.split('\n')));
  const spacedLines: string[] = [];
  let previousBlank = false;

  for (const rawLine of normalizedLines) {
    const trimmedRight = rawLine.replace(/[ \t]+$/g, '');
    if (trimmedRight.trim() === '') {
      if (!previousBlank && spacedLines.length > 0) {
        spacedLines.push('');
      }
      previousBlank = true;
      continue;
    }

    previousBlank = false;

    if (/^( {4,}|\t)/.test(trimmedRight)) {
      spacedLines.push(trimmedRight);
      continue;
    }

    spacedLines.push(applyChineseEnglishSpacing(trimmedRight));
  }

  return normalizeBlockSpacing(preprocessMarkdownTableLines(spacedLines), options).join('\n');
}

function isClosingFence(line: string, fenceMarker: string): boolean {
  const match = line.match(FENCE_MARKER_REGEX);
  return Boolean(match && match[2][0] === fenceMarker[0] && match[2].length >= fenceMarker.length);
}

function formatMarkdownBody(body: string, options: MarkdownFormatOptions): string {
  const lines = body.split('\n');
  const output: string[] = [];
  let textBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let fenceMarker = '';

  const flushTextBuffer = () => {
    if (textBuffer.length === 0) return;
    const formatted = formatTextSegment(textBuffer.join('\n'), options);
    if (formatted) {
      output.push(formatted);
    }
    textBuffer = [];
  };

  const flushCodeBuffer = () => {
    if (codeBuffer.length === 0) return;
    output.push(codeBuffer.join('\n'));
    codeBuffer = [];
  };

  for (const line of lines) {
    if (fenceMarker) {
      codeBuffer.push(line.replace(/[ \t]+$/g, ''));
      if (isClosingFence(line, fenceMarker)) {
        flushCodeBuffer();
        fenceMarker = '';
      }
      continue;
    }

    const fenceMatch = line.match(FENCE_MARKER_REGEX);
    if (fenceMatch) {
      flushTextBuffer();
      fenceMarker = fenceMatch[2];
      codeBuffer.push(line.replace(/[ \t]+$/g, ''));
      continue;
    }

    textBuffer.push(line);
  }

  flushTextBuffer();
  flushCodeBuffer();

  return output.join('\n\n').trim();
}

export function isMarkdownDocumentPath(path: string | null | undefined): boolean {
  return Boolean(path && MARKDOWN_FILE_REGEX.test(path));
}

export function isSavableDocumentPath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (MARKDOWN_FILE_REGEX.test(path)) return true;
  return /\.excalidraw(?:\.json)?$/i.test(path);
}

export function formatMarkdownForSave(content: string, options: MarkdownFormatOptions = {}): string {
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r\n/g, '\n');
  const { frontmatter, body } = splitFrontmatter(normalized);
  const formattedBody = formatMarkdownBody(body, options);

  let result = frontmatter;
  if (frontmatter && formattedBody) {
    result = `${frontmatter}\n\n${formattedBody}`;
  } else if (!frontmatter) {
    result = formattedBody;
  }

  const withTrailingNewline = result ? `${result.replace(/\n+$/g, '')}\n` : '';
  return withTrailingNewline.replace(/\n/g, lineEnding);
}
