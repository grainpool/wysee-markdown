// Copyright 2025-2026 Grainpool Holdings LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as path from 'path';
import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import { parseHTML } from 'linkedom';
import { BlockMapEntry, DanglingReferenceIssue, DocumentStats, SectionWordCount } from '../types';
import { applyImageAttributeSyntax } from '../render/attributeSyntax';
import { preprocessMath } from '../render/markdownRenderer';
import { pathExists } from '../util/files';
import { slugify } from '../util/strings';

interface ReferenceOccurrence {
  kind: 'inlineLink' | 'inlineImage' | 'referenceLink' | 'referenceImage' | 'footnoteRef' | 'htmlLink' | 'htmlImage';
  blockId: string;
  blockKind: string;
  blockStartLine: number;
  relativeStart: number;
  relativeEnd: number;
  label?: string;
  destination?: string;
  text?: string;
}

interface ReferenceDefinition {
  kind: 'referenceDef' | 'footnoteDef';
  key: string;
  blockId: string;
  blockKind: string;
  blockStartLine: number;
  relativeStart: number;
  relativeEnd: number;
  destination?: string;
  content?: string;
}

const md = new MarkdownIt({ html: true, linkify: true, breaks: false });
md.use(markdownItTaskLists, { enabled: true, label: true });

export async function buildDocumentStats(
  document: vscode.TextDocument,
  blockMap: BlockMapEntry[],
  sectionDepth: number,
): Promise<DocumentStats> {
  const resolvedSectionDepth = clampHeadingDepth(sectionDepth);
  const plainParts: string[] = [];
  const sections = computeSectionWordCounts(blockMap, resolvedSectionDepth);

  let paragraphCount = 0;
  let tableCount = 0;
  let diagramCount = 0;
  let codeBlockLineCount = 0;

  for (const block of blockMap) {
    if (block.kind === 'paragraph') {
      paragraphCount += 1;
    }
    if (block.kind === 'table') {
      tableCount += 1;
    }
    if (block.kind === 'mermaidFence') {
      diagramCount += 1;
    }
    if (block.kind === 'codeFence') {
      codeBlockLineCount += countFenceBodyLines(block.raw);
    }

    const plain = extractVisiblePlainText(block);
    if (plain) {
      plainParts.push(plain);
    }
  }

  const plainText = plainParts.join('\n\n').replace(/\u00A0/g, ' ').trim();
  const wordCount = countWords(plainText);
  const dangling = await analyzeDanglingReferences(document, blockMap);

  return {
    wordCount,
    readingTimeMinutes: wordCount === 0 ? 0 : Math.max(1, Math.ceil(wordCount / 200)),
    characterCountPlainText: plainText.length,
    characterCountNoSpaces: plainText.replace(/\s+/g, '').length,
    characterCountWithMarkup: document.getText().length,
    paragraphCount,
    tableCount,
    imageCount: dangling.imageCount,
    diagramCount,
    codeBlockLineCount,
    sectionDepth: resolvedSectionDepth,
    sections,
    danglingReferenceCount: dangling.issues.length,
    danglingIssues: dangling.issues,
  };
}

export function clampHeadingDepth(value: number | undefined): number {
  const numeric = Number(value ?? 1);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(6, Math.max(1, Math.round(numeric)));
}

export function extractVisiblePlainText(block: BlockMapEntry): string {
  if (block.kind === 'directive' || block.kind === 'horizontalRule') {
    return '';
  }
  if (block.kind === 'footnoteDefinition') {
    return normalizeWhitespace(extractFootnoteDefinitionContent(block.raw));
  }
  if (block.kind === 'mermaidFence') {
    return normalizeWhitespace(extractMermaidSourceText(block.raw));
  }
  try {
    const prepared = preprocessMath(applyImageAttributeSyntax(block.raw));
    const html = md.render(prepared);
    const { document } = parseHTML(`<html><body>${html}</body></html>`);
    return normalizeWhitespace(String(document.body.textContent || ''));
  } catch {
    return normalizeWhitespace(block.raw);
  }
}

function extractMermaidSourceText(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines.length <= 2) {
    return '';
  }
  return lines.slice(1, -1).join(' ');
}

function extractFootnoteDefinitionContent(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (!lines.length) {
    return '';
  }
  const first = lines[0].replace(/^\[\^[^\]]+\]:\s*/, '');
  const rest = lines.slice(1).map((line) => line.replace(/^\s+/, ''));
  return [first, ...rest].join(' ');
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function countFenceBodyLines(raw: string): number {
  const lines = raw.split(/\r?\n/);
  if (!lines.length) {
    return 0;
  }
  const opener = lines[0].match(/^(```+|~~~+)/)?.[1];
  if (!opener) {
    return 0;
  }
  const hasClosing = lines.length > 1 && lines[lines.length - 1].startsWith(opener);
  if (hasClosing) {
    return Math.max(0, lines.length - 2);
  }
  return Math.max(0, lines.length - 1);
}

function countWords(text: string): number {
  const matches = text.match(/[A-Za-z0-9]+(?:[’'_-][A-Za-z0-9]+)*/g);
  return matches ? matches.length : 0;
}

export function computeSectionWordCounts(blockMap: BlockMapEntry[], sectionDepth: number): SectionWordCount[] {
  const sections: SectionWordCount[] = [];
  let current: SectionWordCount | undefined;

  for (const block of blockMap) {
    if (block.kind === 'heading') {
      const depth = Number(block.meta?.depth ?? 1);
      if (depth <= sectionDepth) {
        current = {
          heading: normalizeWhitespace(block.raw.replace(/^#{1,6}\s+/, '')) || `Heading ${sections.length + 1}`,
          level: depth,
          wordCount: countWords(extractVisiblePlainText(block)),
          blockId: block.blockId,
          startLine: block.startLine,
        };
        sections.push(current);
        continue;
      }
    }

    const words = countWords(extractVisiblePlainText(block));
    if (!words) {
      continue;
    }
    if (!current) {
      current = {
        heading: 'Document Start',
        level: 0,
        wordCount: 0,
        blockId: block.blockId,
        startLine: block.startLine,
      };
      sections.push(current);
    }
    current.wordCount += words;
  }

  return sections;
}

async function analyzeDanglingReferences(
  document: vscode.TextDocument,
  blockMap: BlockMapEntry[],
): Promise<{ imageCount: number; issues: DanglingReferenceIssue[] }> {
  const issues: DanglingReferenceIssue[] = [];
  const occurrences: ReferenceOccurrence[] = [];
  const referenceDefinitions = new Map<string, ReferenceDefinition>();
  const footnoteDefinitions = new Map<string, ReferenceDefinition>();
  const usedReferenceDefinitions = new Set<string>();
  const usedFootnoteDefinitions = new Set<string>();
  const seenDefinitionIssues = new Set<string>();
  const headingAnchors = collectHeadingAnchors(blockMap);

  let imageCount = 0;

  for (const block of blockMap) {
    if (block.kind === 'codeFence' || block.kind === 'mermaidFence') {
      continue;
    }

    const inlineMasked = maskInlineCode(block.raw);
    const definitionMasked = maskDefinitionLines(block, inlineMasked, referenceDefinitions, footnoteDefinitions);
    const scanned = scanBlockReferences(block, definitionMasked, block.raw);
    occurrences.push(...scanned.occurrences);
    imageCount += scanned.imageCount;
  }

  for (const occurrence of occurrences) {
    if (occurrence.kind === 'inlineLink' || occurrence.kind === 'inlineImage' || occurrence.kind === 'htmlLink' || occurrence.kind === 'htmlImage') {
      const classification = occurrence.kind.includes('Image') ? 'image' : 'link';
      const validation = await validateDestination(document.uri, occurrence.destination || '', headingAnchors);
      if (!validation.valid) {
        issues.push(makeIssue(occurrence.blockId, occurrence.blockStartLine, occurrence.relativeStart, occurrence.relativeEnd, classification, validation.reason, occurrence.text || occurrence.destination || '', blockMap.find((item) => item.blockId === occurrence.blockId)?.raw || ''));
      }
      continue;
    }

    if (occurrence.kind === 'referenceLink' || occurrence.kind === 'referenceImage') {
      const key = normalizeReferenceKey(occurrence.label || '');
      const definition = referenceDefinitions.get(key);
      if (!definition) {
        issues.push(makeIssue(occurrence.blockId, occurrence.blockStartLine, occurrence.relativeStart, occurrence.relativeEnd, 'reference', 'Missing reference definition.', occurrence.text || occurrence.label || '', blockMap.find((item) => item.blockId === occurrence.blockId)?.raw || ''));
        continue;
      }
      usedReferenceDefinitions.add(key);
      if (!seenDefinitionIssues.has(`reference:${key}`)) {
        const validation = await validateDestination(document.uri, definition.destination || '', headingAnchors);
        if (!validation.valid) {
          seenDefinitionIssues.add(`reference:${key}`);
          issues.push(makeIssue(definition.blockId, definition.blockStartLine, definition.relativeStart, definition.relativeEnd, 'reference', validation.reason, definition.destination || occurrence.label || '', blockMap.find((item) => item.blockId === definition.blockId)?.raw || ''));
        }
      }
      continue;
    }

    if (occurrence.kind === 'footnoteRef') {
      const key = normalizeFootnoteKey(occurrence.label || '');
      const definition = footnoteDefinitions.get(key);
      if (!definition) {
        issues.push(makeIssue(occurrence.blockId, occurrence.blockStartLine, occurrence.relativeStart, occurrence.relativeEnd, 'footnote', 'Missing footnote definition.', occurrence.label || '', blockMap.find((item) => item.blockId === occurrence.blockId)?.raw || ''));
        continue;
      }
      usedFootnoteDefinitions.add(key);
    }
  }

  for (const [key, definition] of footnoteDefinitions.entries()) {
    if (!normalizeWhitespace(definition.content || '')) {
      issues.push(makeIssue(definition.blockId, definition.blockStartLine, definition.relativeStart, definition.relativeEnd, 'footnote', 'Footnote definition has no content.', definition.key, blockMap.find((item) => item.blockId === definition.blockId)?.raw || ''));
      continue;
    }
    if (!usedFootnoteDefinitions.has(key)) {
      issues.push(makeIssue(definition.blockId, definition.blockStartLine, definition.relativeStart, definition.relativeEnd, 'footnote', 'Footnote definition is not referenced.', definition.key, blockMap.find((item) => item.blockId === definition.blockId)?.raw || ''));
    }
  }

  for (const [key, definition] of referenceDefinitions.entries()) {
    if (!normalizeWhitespace(definition.destination || '')) {
      issues.push(makeIssue(definition.blockId, definition.blockStartLine, definition.relativeStart, definition.relativeEnd, 'reference', 'Reference definition has no destination.', definition.key, blockMap.find((item) => item.blockId === definition.blockId)?.raw || ''));
      continue;
    }
    if (!usedReferenceDefinitions.has(key)) {
      issues.push(makeIssue(definition.blockId, definition.blockStartLine, definition.relativeStart, definition.relativeEnd, 'reference', 'Reference definition is not used.', definition.key, blockMap.find((item) => item.blockId === definition.blockId)?.raw || ''));
    }
  }

  return { imageCount, issues: sortIssues(uniqueIssues(issues)) };
}

function uniqueIssues(issues: DanglingReferenceIssue[]): DanglingReferenceIssue[] {
  const seen = new Set<string>();
  const out: DanglingReferenceIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.blockId}|${issue.relativeStart}|${issue.relativeEnd}|${issue.kind}|${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(issue);
  }
  return out;
}

function sortIssues(issues: DanglingReferenceIssue[]): DanglingReferenceIssue[] {
  return [...issues].sort((a, b) => {
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    if (a.relativeStart !== b.relativeStart) {
      return a.relativeStart - b.relativeStart;
    }
    return a.kind.localeCompare(b.kind);
  });
}

function makeIssue(
  blockId: string,
  blockStartLine: number,
  relativeStart: number,
  relativeEnd: number,
  kind: DanglingReferenceIssue['kind'],
  message: string,
  snippet: string,
  blockRaw: string,
): DanglingReferenceIssue {
  return {
    id: `${blockId}:${relativeStart}:${relativeEnd}:${kind}:${message}`,
    kind,
    message,
    snippet: normalizeWhitespace(snippet).slice(0, 160),
    blockId,
    relativeStart,
    relativeEnd,
    line: blockStartLine + countNewlines(blockRaw.slice(0, relativeStart)),
  };
}

function countNewlines(text: string): number {
  return (text.match(/\n/g) || []).length;
}

function collectHeadingAnchors(blockMap: BlockMapEntry[]): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const block of blockMap) {
    if (block.kind !== 'heading') {
      continue;
    }
    const plain = normalizeWhitespace(extractVisiblePlainText(block));
    const base = slugify(plain || 'section');
    const ordinal = seen.get(base) || 0;
    seen.set(base, ordinal + 1);
    anchors.add(ordinal === 0 ? base : `${base}-${ordinal}`);
  }
  return anchors;
}

function maskDefinitionLines(
  block: BlockMapEntry,
  input: string,
  referenceDefinitions: Map<string, ReferenceDefinition>,
  footnoteDefinitions: Map<string, ReferenceDefinition>,
): string {
  const chars = input.split('');
  const lines = block.raw.split(/\r?\n/);
  let offset = 0;

  for (const line of lines) {
    const footnoteMatch = /^\[\^([^\]]+)\]:\s*([\s\S]*)$/.exec(line);
    if (footnoteMatch) {
      const key = normalizeFootnoteKey(footnoteMatch[1]);
      if (!footnoteDefinitions.has(key)) {
        footnoteDefinitions.set(key, {
          kind: 'footnoteDef',
          key: footnoteMatch[1],
          blockId: block.blockId,
          blockKind: block.kind,
          blockStartLine: block.startLine,
          relativeStart: offset,
          relativeEnd: offset + line.length,
          content: block.kind === 'footnoteDefinition' ? extractFootnoteDefinitionContent(block.raw) : footnoteMatch[2],
        });
      }
      for (let i = offset; i < offset + line.length; i += 1) {
        chars[i] = ' ';
      }
    } else {
      const refMatch = /^\s{0,3}\[([^\]]+)\]:\s*(\S[\s\S]*)?$/.exec(line);
      if (refMatch) {
        const key = normalizeReferenceKey(refMatch[1]);
        if (!referenceDefinitions.has(key)) {
          referenceDefinitions.set(key, {
            kind: 'referenceDef',
            key: refMatch[1],
            blockId: block.blockId,
            blockKind: block.kind,
            blockStartLine: block.startLine,
            relativeStart: offset,
            relativeEnd: offset + line.length,
            destination: parseReferenceDefinitionDestination(refMatch[2] || ''),
          });
        }
        for (let i = offset; i < offset + line.length; i += 1) {
          chars[i] = ' ';
        }
      }
    }
    offset += line.length + 1;
  }

  return chars.join('');
}

function scanBlockReferences(
  block: BlockMapEntry,
  masked: string,
  original: string,
): { imageCount: number; occurrences: ReferenceOccurrence[] } {
  const occurrences: ReferenceOccurrence[] = [];
  let imageCount = 0;

  for (let i = 0; i < masked.length; i += 1) {
    const char = masked[i];
    const next = masked[i + 1];
    if (char === '!' && next === '[') {
      const parsed = parseMarkdownLinkLike(masked, original, i, true);
      if (parsed) {
        occurrences.push({
          kind: parsed.kind === 'inline' ? 'inlineImage' : 'referenceImage',
          blockId: block.blockId,
          blockKind: block.kind,
          blockStartLine: block.startLine,
          relativeStart: parsed.selectionStart,
          relativeEnd: parsed.selectionEnd,
          label: parsed.label,
          destination: parsed.destination,
          text: parsed.text,
        });
        imageCount += 1;
        i = parsed.end - 1;
      }
      continue;
    }

    if (char === '[') {
      if (next === '^') {
        const end = masked.indexOf(']', i + 2);
        if (end > i + 2) {
          const label = original.slice(i + 2, end);
          occurrences.push({
            kind: 'footnoteRef',
            blockId: block.blockId,
            blockKind: block.kind,
            blockStartLine: block.startLine,
            relativeStart: i,
            relativeEnd: end + 1,
            label,
            text: label,
          });
          i = end;
        }
        continue;
      }
      const parsed = parseMarkdownLinkLike(masked, original, i, false);
      if (parsed) {
        occurrences.push({
          kind: parsed.kind === 'inline' ? 'inlineLink' : 'referenceLink',
          blockId: block.blockId,
          blockKind: block.kind,
          blockStartLine: block.startLine,
          relativeStart: parsed.selectionStart,
          relativeEnd: parsed.selectionEnd,
          label: parsed.label,
          destination: parsed.destination,
          text: parsed.text,
        });
        i = parsed.end - 1;
      }
    }
  }

  const htmlResults = scanHtmlTargets(block, masked, original);
  occurrences.push(...htmlResults.occurrences);
  imageCount += htmlResults.imageCount;

  return { imageCount, occurrences };
}

function scanHtmlTargets(
  block: BlockMapEntry,
  masked: string,
  original: string,
): { imageCount: number; occurrences: ReferenceOccurrence[] } {
  const occurrences: ReferenceOccurrence[] = [];
  let imageCount = 0;

  const imgRegex = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(masked))) {
    const destination = match[1] || match[2] || match[3] || '';
    const relativeStart = match.index + match[0].indexOf(destination);
    occurrences.push({
      kind: 'htmlImage',
      blockId: block.blockId,
      blockKind: block.kind,
      blockStartLine: block.startLine,
      relativeStart,
      relativeEnd: relativeStart + destination.length,
      destination,
      text: original.slice(relativeStart, relativeStart + destination.length),
    });
    imageCount += 1;
  }

  const linkRegex = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  while ((match = linkRegex.exec(masked))) {
    const destination = match[1] || match[2] || match[3] || '';
    const relativeStart = match.index + match[0].indexOf(destination);
    occurrences.push({
      kind: 'htmlLink',
      blockId: block.blockId,
      blockKind: block.kind,
      blockStartLine: block.startLine,
      relativeStart,
      relativeEnd: relativeStart + destination.length,
      destination,
      text: original.slice(relativeStart, relativeStart + destination.length),
    });
  }

  return { imageCount, occurrences };
}

function parseMarkdownLinkLike(
  masked: string,
  original: string,
  start: number,
  image: boolean,
): { kind: 'inline' | 'reference'; end: number; label?: string; destination?: string; selectionStart: number; selectionEnd: number; text: string } | undefined {
  const openBracket = image ? start + 1 : start;
  const closeBracket = findMatchingBracket(masked, openBracket);
  if (closeBracket < 0) {
    return undefined;
  }
  const text = original.slice(openBracket + 1, closeBracket);
  const next = masked[closeBracket + 1];
  if (next === '(') {
    const closeParen = findMatchingParen(masked, closeBracket + 1);
    if (closeParen < 0) {
      return undefined;
    }
    const inner = original.slice(closeBracket + 2, closeParen);
    const destination = parseInlineDestination(inner);
    const destinationOffsetInInner = inner.indexOf(destination);
    const selectionStart = destinationOffsetInInner >= 0 ? closeBracket + 2 + destinationOffsetInInner : closeBracket + 2;
    const selectionEnd = selectionStart + destination.length;
    return {
      kind: 'inline',
      end: closeParen + 1,
      destination,
      selectionStart,
      selectionEnd: Math.max(selectionStart, selectionEnd),
      text,
    };
  }
  if (next === '[') {
    const refClose = findMatchingBracket(masked, closeBracket + 1);
    if (refClose < 0) {
      return undefined;
    }
    const explicitLabel = original.slice(closeBracket + 2, refClose);
    const label = explicitLabel || text;
    return {
      kind: 'reference',
      end: refClose + 1,
      label,
      selectionStart: closeBracket + 2,
      selectionEnd: refClose,
      text,
    };
  }
  return undefined;
}

function findMatchingBracket(text: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '[') {
      depth += 1;
      continue;
    }
    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function parseInlineDestination(inner: string): string {
  const trimmed = inner.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>');
    return close > 0 ? trimmed.slice(1, close).trim() : trimmed;
  }
  let depth = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')' && depth > 0) {
      depth -= 1;
      continue;
    }
    if (/\s/.test(char) && depth === 0) {
      return trimmed.slice(0, i).trim();
    }
  }
  return trimmed;
}

function parseReferenceDefinitionDestination(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('<')) {
    const close = trimmed.indexOf('>');
    return close > 0 ? trimmed.slice(1, close).trim() : trimmed;
  }
  const match = /^(\S+)/.exec(trimmed);
  return match ? match[1] : trimmed;
}

function maskInlineCode(input: string): string {
  const chars = input.split('');
  for (let i = 0; i < input.length; i += 1) {
    if (input[i] !== '`') {
      continue;
    }
    let runLength = 1;
    while (input[i + runLength] === '`') {
      runLength += 1;
    }
    const fence = '`'.repeat(runLength);
    let close = -1;
    for (let j = i + runLength; j < input.length; j += 1) {
      if (input.startsWith(fence, j)) {
        close = j;
        break;
      }
    }
    if (close >= 0) {
      for (let j = i; j < close + runLength; j += 1) {
        chars[j] = ' ';
      }
      i = close + runLength - 1;
    }
  }
  return chars.join('');
}

function normalizeReferenceKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeFootnoteKey(label: string): string {
  return label.trim().toLowerCase();
}

async function validateDestination(
  documentUri: vscode.Uri,
  rawDestination: string,
  headingAnchors: Set<string>,
): Promise<{ valid: boolean; reason: string }> {
  const destination = rawDestination.trim();
  if (!destination) {
    return { valid: false, reason: 'Empty destination.' };
  }

  if (destination.startsWith('#')) {
    const fragment = decodeURIComponent(destination.slice(1)).trim();
    if (!fragment) {
      return { valid: false, reason: 'Empty anchor destination.' };
    }
    if (!headingAnchors.has(fragment) && !headingAnchors.has(slugify(fragment))) {
      return { valid: false, reason: 'Anchor does not match a heading in this document.' };
    }
    return { valid: true, reason: '' };
  }

  if (/^data:/i.test(destination)) {
    return /^data:[^,]+,.+/i.test(destination)
      ? { valid: true, reason: '' }
      : { valid: false, reason: 'Invalid data URL.' };
  }

  if (/^[A-Za-z]:[\\/]/.test(destination)) {
    return validateLocalPath(destination, documentUri);
  }

  if (/^(https?|ftp):/i.test(destination)) {
    return validateAbsoluteUrl(destination);
  }

  if (/^mailto:/i.test(destination)) {
    return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+/i.test(destination)
      ? { valid: true, reason: '' }
      : { valid: false, reason: 'Invalid mailto destination.' };
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(destination)) {
    try {
      // Accept other absolute URI schemes if they parse cleanly.
      new URL(destination);
      return { valid: true, reason: '' };
    } catch {
      return { valid: false, reason: 'Invalid absolute URI.' };
    }
  }

  return validateLocalPath(destination, documentUri);
}

async function validateLocalPath(destination: string, documentUri: vscode.Uri): Promise<{ valid: boolean; reason: string }> {
  const withoutFragment = destination.split('#')[0].split('?')[0].trim();
  if (!withoutFragment || withoutFragment === '.' || withoutFragment === '..') {
    return { valid: false, reason: 'Invalid local path.' };
  }
  const resolved = path.isAbsolute(withoutFragment)
    ? withoutFragment
    : path.resolve(path.dirname(documentUri.fsPath), withoutFragment);
  const exists = await pathExists(resolved);
  return exists
    ? { valid: true, reason: '' }
    : { valid: false, reason: 'Referenced local file does not exist.' };
}

function validateAbsoluteUrl(destination: string): { valid: boolean; reason: string } {
  try {
    const url = new URL(destination);
    if (!url.hostname) {
      return { valid: false, reason: 'Invalid URL hostname.' };
    }
    if (/^\.|\.$|\.\./.test(url.hostname)) {
      return { valid: false, reason: 'Invalid URL hostname.' };
    }
    if (/\s/.test(url.hostname)) {
      return { valid: false, reason: 'Invalid URL hostname.' };
    }
    return { valid: true, reason: '' };
  } catch {
    return { valid: false, reason: 'Invalid URL.' };
  }
}
