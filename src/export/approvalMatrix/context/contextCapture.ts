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

/**
 * ContextCapture — captures per-hunk context from two rendered models
 * and the existing diff presentation.
 *
 * Uses the flat blockMap (no full AST required). Captures:
 * - heading ancestry by walking backward from the first changed block
 * - table framing from the table header row when a table block changes
 * - list framing from an immediately preceding lead-in paragraph
 * - code context from the fence info string
 * - callout/block labels from directive or title lines
 */

import { RenderViewModel, BlockMapEntry, DiffBlockDecoration } from '../../../types';
import {
  HunkContextNode,
  HunkContextBundle,
  HunkLineSpan,
  CONTEXT_SCHEMA_VERSION,
} from './contextTypes';
import {
  serializeHeadingPath,
  serializeBreadcrumbDisplay,
  serializeFullMarkdownContext,
  serializeContextJson,
} from './markdownContextSerializer';

export interface CapturedHunkContext {
  previousBlockIds: string[];
  newBlockIds: string[];
  previousLineSpans: HunkLineSpan[];
  newLineSpans: HunkLineSpan[];
  bundle: HunkContextBundle;
}

interface HunkBlockCollector {
  groupId: string;
  currentBlockIds: string[];
  previousBlockIds: string[];
}

/**
 * Capture canonical hunk context from the two rendered models.
 */
export function captureHunkContext(args: {
  groupId: string;
  hunkKind: string;
  baseModel: RenderViewModel;
  currentModel: RenderViewModel;
}): CapturedHunkContext {
  const { groupId, hunkKind, baseModel, currentModel } = args;

  // 1. Collect block IDs for each side from diff presentations
  const collector = collectBlockIds(groupId, baseModel, currentModel);

  // 2. Derive line spans from blockMap
  const newLineSpans = resolveLineSpans(collector.currentBlockIds, currentModel.blockMap);
  const previousLineSpans = resolveLineSpans(collector.previousBlockIds, baseModel.blockMap);

  // 3. Find the first changed block's position in the relevant blockMap
  const { blockMap: anchorBlockMap, anchorIndex } = findAnchorPosition(
    collector, currentModel, baseModel,
  );

  // 4. Capture context nodes
  const nodes: HunkContextNode[] = [];

  // Heading ancestry
  captureHeadingAncestry(nodes, anchorBlockMap, anchorIndex);

  // Framing context
  captureFramingContext(nodes, anchorBlockMap, anchorIndex, collector, currentModel, baseModel);

  // 5. De-duplicate deterministically
  deduplicateNodes(nodes);

  // 6. Build the bundle with serialized outputs
  const bundle = buildBundle(nodes, args);

  return {
    previousBlockIds: collector.previousBlockIds,
    newBlockIds: collector.currentBlockIds,
    previousLineSpans,
    newLineSpans,
    bundle,
  };
}

function collectBlockIds(
  groupId: string,
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
): HunkBlockCollector {
  const currentBlockIds: string[] = [];
  const previousBlockIds: string[] = [];

  // Current model: blocks matching groupId that aren't 'unchanged'
  if (currentModel.diff?.blocks) {
    for (const [blockId, dec] of Object.entries(currentModel.diff.blocks)) {
      if (dec.groupId !== groupId || dec.state === 'unchanged') continue;
      if (dec.state !== 'deleted') {
        currentBlockIds.push(blockId);
      }
      // For modified blocks, track the counterpart as a previous block
      if (dec.state === 'modified' && dec.counterpartBlockId) {
        previousBlockIds.push(dec.counterpartBlockId);
      }
    }
  }

  // Base model: blocks matching groupId for deleted content
  if (baseModel.diff?.blocks) {
    for (const [blockId, dec] of Object.entries(baseModel.diff.blocks)) {
      if (dec.groupId !== groupId || dec.state === 'unchanged') continue;
      if (!previousBlockIds.includes(blockId)) {
        previousBlockIds.push(blockId);
      }
    }
  }

  return { groupId, currentBlockIds, previousBlockIds };
}

function resolveLineSpans(blockIds: string[], blockMap: BlockMapEntry[]): HunkLineSpan[] {
  const spans: HunkLineSpan[] = [];
  for (const blockId of blockIds) {
    const entry = blockMap.find(b => b.blockId === blockId);
    if (entry) {
      spans.push({ startLine: entry.startLine, endLine: entry.endLine });
    }
  }
  return spans;
}

function findAnchorPosition(
  collector: HunkBlockCollector,
  currentModel: RenderViewModel,
  baseModel: RenderViewModel,
): { blockMap: BlockMapEntry[]; anchorIndex: number } {
  // Prefer current-side blocks
  const currentBlockMap = currentModel.blockMap ?? [];
  for (const blockId of collector.currentBlockIds) {
    const idx = currentBlockMap.findIndex(b => b.blockId === blockId);
    if (idx >= 0) return { blockMap: currentBlockMap, anchorIndex: idx };
  }

  // Fall back to base-side blocks
  const baseBlockMap = baseModel.blockMap ?? [];
  for (const blockId of collector.previousBlockIds) {
    const idx = baseBlockMap.findIndex(b => b.blockId === blockId);
    if (idx >= 0) return { blockMap: baseBlockMap, anchorIndex: idx };
  }

  return { blockMap: currentBlockMap, anchorIndex: -1 };
}

// ── Heading ancestry ──────────────────────────────────────────────

function captureHeadingAncestry(
  nodes: HunkContextNode[],
  blockMap: BlockMapEntry[],
  anchorIndex: number,
): void {
  if (anchorIndex < 0 || !blockMap.length) return;

  const headings: { level: number; markdown: string; blockId: string; depth: number }[] = [];

  for (let i = anchorIndex; i >= 0; i--) {
    const block = blockMap[i];
    const match = block.raw.match(/^(#{1,6})\s+(.+)/);
    if (!match) continue;

    const level = match[1].length;
    const fullHeading = match[0].replace(/\s*#+\s*$/, '').trim(); // preserve # markers, strip trailing #

    // Only add if this heading is higher level than any already collected
    if (!headings.length || level < headings[0].level) {
      headings.unshift({ level, markdown: fullHeading, blockId: block.blockId, depth: level });
    }
  }

  for (const h of headings) {
    nodes.push({
      role: 'heading',
      relation: 'ancestor',
      markdown: h.markdown,
      blockId: h.blockId,
      depth: h.depth,
    });
  }
}

// ── Framing context ───────────────────────────────────────────────

function captureFramingContext(
  nodes: HunkContextNode[],
  blockMap: BlockMapEntry[],
  anchorIndex: number,
  collector: HunkBlockCollector,
  currentModel: RenderViewModel,
  baseModel: RenderViewModel,
): void {
  if (anchorIndex < 0 || !blockMap.length) return;

  const anchorBlock = blockMap[anchorIndex];
  if (!anchorBlock) return;

  // Table framing: if changed block is a table row, capture the table header
  captureTableFraming(nodes, blockMap, anchorIndex, anchorBlock);

  // List lead-in: if changed block is a list item, capture preceding paragraph
  captureListLeadIn(nodes, blockMap, anchorIndex, anchorBlock);

  // Code context: if changed block is a code fence, capture info string
  captureCodeContext(nodes, anchorBlock);

  // Callout/directive context
  captureCalloutContext(nodes, blockMap, anchorIndex, anchorBlock);
}

function captureTableFraming(
  nodes: HunkContextNode[],
  blockMap: BlockMapEntry[],
  anchorIndex: number,
  anchorBlock: BlockMapEntry,
): void {
  if (anchorBlock.kind !== 'table') return;

  // Extract the first row (header row) from the table markdown
  const lines = anchorBlock.raw.split('\n');
  const headerLine = lines[0]?.trim();
  if (headerLine && headerLine.startsWith('|')) {
    nodes.push({
      role: 'tableHeader',
      relation: 'framing',
      markdown: headerLine,
      blockId: anchorBlock.blockId,
    });
  }
}

function captureListLeadIn(
  nodes: HunkContextNode[],
  blockMap: BlockMapEntry[],
  anchorIndex: number,
  anchorBlock: BlockMapEntry,
): void {
  if (anchorBlock.kind !== 'listItem') return;
  if (anchorIndex < 1) return;

  // Look at the immediately preceding block
  const prev = blockMap[anchorIndex - 1];
  if (!prev) return;

  // Only capture if it's a paragraph that plausibly leads in to the list
  if (prev.kind === 'paragraph') {
    const text = prev.raw.trim();
    // Heuristic: a short paragraph (< 200 chars) right before a list item is likely a lead-in
    if (text.length > 0 && text.length < 200) {
      nodes.push({
        role: 'leadIn',
        relation: 'framing',
        markdown: text,
        blockId: prev.blockId,
      });
    }
  }
}

function captureCodeContext(
  nodes: HunkContextNode[],
  anchorBlock: BlockMapEntry,
): void {
  if (anchorBlock.kind !== 'codeFence' && anchorBlock.kind !== 'code') return;

  const infoMatch = anchorBlock.raw.match(/^```(\S+)/);
  if (infoMatch) {
    nodes.push({
      role: 'codeContext',
      relation: 'framing',
      markdown: `\`\`\`${infoMatch[1]}`,
      meta: { language: infoMatch[1] },
    });
  }
}

function captureCalloutContext(
  nodes: HunkContextNode[],
  blockMap: BlockMapEntry[],
  anchorIndex: number,
  anchorBlock: BlockMapEntry,
): void {
  // Check for blockquote-based callouts (e.g. > **Note:** ...)
  if (anchorBlock.kind === 'blockquote') {
    const titleMatch = anchorBlock.raw.match(/^>\s*\*\*([^*]+)\*\*/);
    if (titleMatch) {
      nodes.push({
        role: 'calloutTitle',
        relation: 'framing',
        markdown: titleMatch[1].trim(),
        blockId: anchorBlock.blockId,
      });
    }
    return;
  }

  // Check for directive comments above the block
  if (anchorIndex < 1) return;
  const prev = blockMap[anchorIndex - 1];
  if (prev?.kind === 'directive' || prev?.raw.trim().startsWith('<!--')) {
    const directiveMatch = prev.raw.match(/<!--\s*wysee:(\S+)/);
    if (directiveMatch) {
      nodes.push({
        role: 'blockTypeLabel',
        relation: 'framing',
        markdown: directiveMatch[1],
        blockId: prev.blockId,
      });
    }
  }
}

// ── De-duplication ────────────────────────────────────────────────

function deduplicateNodes(nodes: HunkContextNode[]): void {
  const seen = new Set<string>();
  let writeIdx = 0;
  for (let i = 0; i < nodes.length; i++) {
    const key = `${nodes[i].role}|${nodes[i].relation}|${nodes[i].markdown}`;
    if (!seen.has(key)) {
      seen.add(key);
      nodes[writeIdx] = nodes[i];
      writeIdx++;
    }
  }
  nodes.length = writeIdx;
}

// ── Bundle assembly ───────────────────────────────────────────────

function buildBundle(
  nodes: HunkContextNode[],
  _args: { groupId: string; hunkKind: string },
): HunkContextBundle {
  const headingPathMarkdown = serializeHeadingPath(nodes);
  const breadcrumbDisplay = serializeBreadcrumbDisplay({ nodes });
  const fullMarkdownContext = serializeFullMarkdownContext(nodes);
  const contextJson = serializeContextJson(nodes);
  const contextRoles = nodes.map(n => n.role).join(',');

  return {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    nodes,
    headingPathMarkdown,
    breadcrumbDisplay,
    fullMarkdownContext,
    contextJson,
    contextRoles,
  };
}
