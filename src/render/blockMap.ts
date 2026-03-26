import * as vscode from 'vscode';
import { BlockMapEntry } from '../types';
import { hashString } from '../util/strings';
import { parseDirective } from './directives';

interface MutableBlock extends BlockMapEntry {}

export function buildBlockMap(document: vscode.TextDocument): BlockMapEntry[] {
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const lineOffsets = computeLineOffsets(lines, text);
  const blocks: MutableBlock[] = [];
  let i = 0;

  if (lines[0] === '---') {
    let j = 1;
    while (j < lines.length && lines[j] !== '---') {
      j += 1;
    }
    if (j < lines.length) {
      i = j + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const startLine = i;
    const directive = parseDirective(line);
    if (directive) {
      i += 1;
      blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, 'directive', { directive }));
      continue;
    }
    const fence = /^(```+|~~~+)(.*)$/.exec(line);
    if (fence) {
      const opener = fence[1];
      const info = fence[2].trim();
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith(opener)) {
        j += 1;
      }
      if (j < lines.length) {
        i = j + 1;
      } else {
        i = lines.length;
      }
      blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, info === 'mermaid' ? 'mermaidFence' : 'codeFence', { info }));
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      i += 1;
      blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, 'heading', { depth: line.match(/^#+/)?.[0].length ?? 1 }));
      continue;
    }
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      i += 1;
      blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, 'horizontalRule'));
      continue;
    }
    if (isTableHeader(lines, i)) {
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
        j += 1;
      }
      i = j;
      blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, 'table'));
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && /^\s*>\s?/.test(lines[j])) {
        j += 1;
      }
      i = j;
      blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, 'blockquote'));
      continue;
    }
    if (isListItem(line)) {
      const { kind, ordered, task } = listMeta(line);
      let j = i + 1;
      const baseIndent = indentation(line);
      while (j < lines.length) {
        const candidate = lines[j];
        if (!candidate.trim()) {
          break;
        }
        if (isListItem(candidate) && indentation(candidate) <= baseIndent) {
          break;
        }
        j += 1;
      }
      i = j;
      const indentLevel = Math.floor(baseIndent / 2);
      blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, 'listItem', { listKind: kind, ordered, task, indent: indentLevel }));
      continue;
    }
    if (/^\[\^[^\]]+\]:\s/.test(line)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && /^\s/.test(lines[j])) {
        j += 1;
      }
      i = j;
      blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, 'footnoteDefinition'));
      continue;
    }
    let pj = i + 1;
    while (pj < lines.length && lines[pj].trim() && !startsNewBlock(lines, pj)) {
      pj += 1;
    }
    i = pj;
    blocks.push(makeBlock(document, lines, lineOffsets, blocks, startLine, i - 1, 'paragraph'));
  }

  return blocks;
}

function startsNewBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  return Boolean(
    parseDirective(line)
    || /^(```+|~~~+)/.test(line)
    || /^#{1,6}\s+/.test(line)
    || /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)
    || isTableHeader(lines, index)
    || /^\s*>\s?/.test(line)
    || isListItem(line)
    || /^\[\^[^\]]+\]:\s/.test(line)
  );
}

function computeLineOffsets(lines: string[], originalText: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    offsets.push(offset);
    offset += lines[i].length;
    if (offset < originalText.length) {
      offset += 1;
    }
  }
  offsets.push(originalText.length);
  return offsets;
}

function makeBlock(
  document: vscode.TextDocument,
  lines: string[],
  lineOffsets: number[],
  existing: BlockMapEntry[],
  startLine: number,
  endLine: number,
  kind: string,
  meta?: Record<string, unknown>,
): MutableBlock {
  const startOffset = lineOffsets[startLine];
  const endOffset = endLine + 1 < lineOffsets.length ? lineOffsets[endLine + 1] : document.getText().length;
  const raw = lines.slice(startLine, endLine + 1).join('\n');
  const ordinal = existing.filter((b) => b.startLine === startLine && b.kind === kind).length;
  const blockId = `b:${hashString(`${document.uri.toString()}|${startLine}|${kind}|${ordinal}`)}`;
  return {
    blockId,
    uri: document.uri.toString(),
    version: document.version,
    kind,
    startLine,
    endLine,
    startOffset,
    endOffset,
    ordinal,
    raw,
    meta,
  };
}

function isTableHeader(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) {
    return false;
  }
  const header = lines[index];
  const align = lines[index + 1];
  return header.includes('|') && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(align);
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}

function indentation(line: string): number {
  return (line.match(/^\s*/) ?? [''])[0].length;
}

function listMeta(line: string): { kind: string; ordered: boolean; task: boolean } {
  const ordered = /^\s*\d+[.)]\s+/.test(line);
  const task = /^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s+/.test(line);
  return { kind: ordered ? 'ordered' : 'unordered', ordered, task };
}
