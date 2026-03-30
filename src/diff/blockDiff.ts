import { parseHTML } from 'linkedom';
import { DiffBlockDecoration, DiffDeletionMarkerPresentation, DiffHunk, DiffInlineRange, DiffPlaceholderPresentation, DiffUnchangedRun, DiffViewPresentation, RenderViewModel } from '../types';

interface ComparableBlock {
  blockId: string;
  kind: string;
  raw: string;
  text: string;
  lineCount: number;
}

type AlignmentRowKind = 'equal' | 'modified' | 'added' | 'deleted';

interface AlignmentRow {
  kind: AlignmentRowKind;
  oldBlock?: ComparableBlock;
  newBlock?: ComparableBlock;
  oldRanges?: DiffInlineRange[];
  newRanges?: DiffInlineRange[];
}

interface SequenceOp {
  type: 'equal' | 'delete' | 'insert';
  oldIndex?: number;
  newIndex?: number;
}

export function buildAllAddedPresentation(
  model: RenderViewModel,
  comparisonLabel = 'Git changes',
): DiffViewPresentation {
  const blocks: Record<string, DiffBlockDecoration> = {};
  let firstAnchorId: string | undefined;
  let added = 0;
  for (const block of extractVisibleBlocks(model)) {
    blocks[block.blockId] = { state: 'added' };
    added += 1;
    firstAnchorId ??= block.blockId;
  }
  return {
    mode: 'git',
    comparisonLabel,
    readOnly: false,
    firstAnchorId,
    blocks,
    placeholders: [],
    deletionMarkers: [],
    hunks: firstAnchorId ? [{ id: 'hunk-all-added', index: 0, kind: 'added', anchorId: firstAnchorId, groupId: 'all-added' }] : [],
    unchangedRuns: [],
    summary: { added, deleted: 0, modified: 0 },
  };
}

export function buildConflictPresentation(comparisonLabel = 'Merge conflict state'): DiffViewPresentation {
  return {
    mode: 'git',
    comparisonLabel,
    readOnly: true,
    conflict: true,
    blocks: {},
    placeholders: [],
    deletionMarkers: [],
    hunks: [],
    unchangedRuns: [],
    summary: { added: 0, deleted: 0, modified: 0 },
  };
}

export function buildWorkingTreeDiffPresentation(
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
  comparisonLabel = 'Git changes',
): DiffViewPresentation {
  const rows = alignModels(baseModel, currentModel);
  return buildPresentation(rows, 'modified', 'git', comparisonLabel, false, true);
}

export function buildSideBySideDiffPresentations(
  originalModel: RenderViewModel,
  modifiedModel: RenderViewModel,
  comparisonLabel = 'Open Changes',
): { original: DiffViewPresentation; modified: DiffViewPresentation } {
  const rows = alignModels(originalModel, modifiedModel);
  return {
    original: buildPresentation(rows, 'original', 'diff', comparisonLabel, true, false),
    modified: buildPresentation(rows, 'modified', 'diff', comparisonLabel, true, false),
  };
}

function alignModels(oldModel: RenderViewModel, newModel: RenderViewModel): AlignmentRow[] {
  const oldBlocks = extractVisibleBlocks(oldModel);
  const newBlocks = extractVisibleBlocks(newModel);
  const oldSignatures = oldBlocks.map(blockSignature);
  const newSignatures = newBlocks.map(blockSignature);
  const ops = diffSequence(oldSignatures, newSignatures);
  const rows: AlignmentRow[] = [];

  let pendingDeletes: number[] = [];
  let pendingInserts: number[] = [];

  const flushPending = (): void => {
    if (!pendingDeletes.length && !pendingInserts.length) {
      return;
    }
    const oldChunk = pendingDeletes.map(index => oldBlocks[index]);
    const newChunk = pendingInserts.map(index => newBlocks[index]);
    rows.push(...alignChangedChunk(oldChunk, newChunk));
    pendingDeletes = [];
    pendingInserts = [];
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      flushPending();
      const oldBlock = oldBlocks[op.oldIndex!];
      const newBlock = newBlocks[op.newIndex!];
      rows.push({ kind: 'equal', oldBlock, newBlock });
      continue;
    }
    if (op.type === 'delete') {
      pendingDeletes.push(op.oldIndex!);
      continue;
    }
    pendingInserts.push(op.newIndex!);
  }

  flushPending();
  return rows;
}

function buildPresentation(
  rows: AlignmentRow[],
  side: 'original' | 'modified',
  mode: 'git' | 'diff',
  comparisonLabel: string,
  readOnly: boolean,
  useDeletionMarkers: boolean,
): DiffViewPresentation {
  const blocks: Record<string, DiffBlockDecoration> = {};
  const placeholders: DiffPlaceholderPresentation[] = [];
  const deletionMarkers: DiffDeletionMarkerPresentation[] = [];
  let firstAnchorId: string | undefined;
  let added = 0;
  let deleted = 0;
  let modified = 0;
  let runCounter = 0;

  const nextBlockIdForSide = (startIndex: number): string | null => {
    for (let i = startIndex + 1; i < rows.length; i += 1) {
      const candidate = side === 'original' ? rows[i].oldBlock : rows[i].newBlock;
      if (candidate) {
        return candidate.blockId;
      }
    }
    return null;
  };

  const describeGroupPosition = (index: number, length: number): DiffBlockDecoration['groupPosition'] => {
    if (length <= 1) {
      return 'single';
    }
    if (index === 0) {
      return 'start';
    }
    if (index === length - 1) {
      return 'end';
    }
    return 'middle';
  };

  const createGroupId = (kind: 'modified' | 'added' | 'deleted'): string => `wysee-diff-${kind}-run-${runCounter++}`;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const currentBlock = side === 'original' ? row.oldBlock : row.newBlock;
    const counterpartBlock = side === 'original' ? row.newBlock : row.oldBlock;

    if (row.kind === 'equal') {
      if (currentBlock) {
        blocks[currentBlock.blockId] = { state: 'unchanged', counterpartBlockId: counterpartBlock?.blockId };
      }
      continue;
    }

    if (row.kind === 'modified') {
      const startIndex = i;
      while (i < rows.length && rows[i].kind === 'modified') {
        i += 1;
      }
      const runRows = rows.slice(startIndex, i);
      const groupId = createGroupId('modified');
      for (let offset = 0; offset < runRows.length; offset += 1) {
        const runRow = runRows[offset];
        const block = side === 'original' ? runRow.oldBlock : runRow.newBlock;
        const counterpart = side === 'original' ? runRow.newBlock : runRow.oldBlock;
        if (!block) {
          continue;
        }
        blocks[block.blockId] = {
          state: 'modified',
          counterpartBlockId: counterpart?.blockId,
          inlineRanges: side === 'original'
            ? runRow.oldRanges ?? []
            : remapInlineTone(runRow.newRanges ?? [], 'added'),
          groupId,
          groupPosition: describeGroupPosition(offset, runRows.length),
        };
        if (!firstAnchorId) {
          firstAnchorId = block.blockId;
        }
      }
      modified += runRows.length;
      i -= 1;
      continue;
    }

    if (row.kind === 'added') {
      const startIndex = i;
      while (i < rows.length && rows[i].kind === 'added') {
        i += 1;
      }
      const runRows = rows.slice(startIndex, i);
      const groupId = createGroupId('added');
      if (side === 'modified') {
        for (let offset = 0; offset < runRows.length; offset += 1) {
          const block = runRows[offset].newBlock;
          if (!block) {
            continue;
          }
          blocks[block.blockId] = {
            state: 'added',
            counterpartBlockId: undefined,
            groupId,
            groupPosition: describeGroupPosition(offset, runRows.length),
          };
          if (!firstAnchorId) {
            firstAnchorId = block.blockId;
          }
        }
      } else {
        const counterpartBlocks = runRows.map((item) => item.newBlock).filter((item): item is ComparableBlock => Boolean(item));
        const id = `wysee-diff-placeholder-${side}-${placeholders.length}`;
        placeholders.push({
          id,
          kind: 'added',
          beforeBlockId: nextBlockIdForSide(i - 1),
          lineCount: Math.max(1, counterpartBlocks.reduce((sum, block) => sum + (block.lineCount ?? 1), 0)),
          blockCount: Math.max(1, counterpartBlocks.length),
          groupId,
        });
        if (!firstAnchorId) {
          firstAnchorId = id;
        }
      }
      added += runRows.length;
      i -= 1;
      continue;
    }

    const startIndex = i;
    while (i < rows.length && rows[i].kind === 'deleted') {
      i += 1;
    }
    const runRows = rows.slice(startIndex, i);
    const groupId = createGroupId('deleted');

    if (side === 'original') {
      for (let offset = 0; offset < runRows.length; offset += 1) {
        const block = runRows[offset].oldBlock;
        if (!block) {
          continue;
        }
        blocks[block.blockId] = {
          state: 'deleted',
          counterpartBlockId: undefined,
          groupId,
          groupPosition: describeGroupPosition(offset, runRows.length),
        };
        if (!firstAnchorId) {
          firstAnchorId = block.blockId;
        }
      }
    }

    if (side === 'modified') {
      const deletedLineCount = runRows.reduce((sum, item) => sum + (item.oldBlock?.lineCount ?? 1), 0);
      if (mode === 'diff') {
        const id = `wysee-diff-placeholder-${side}-${placeholders.length}`;
        placeholders.push({
          id,
          kind: 'deleted',
          beforeBlockId: nextBlockIdForSide(i - 1),
          lineCount: Math.max(1, deletedLineCount),
          blockCount: Math.max(1, runRows.length),
          groupId,
        });
        if (!firstAnchorId) {
          firstAnchorId = id;
        }
      } else if (useDeletionMarkers) {
        const id = `wysee-diff-deletion-${deletionMarkers.length}`;
        deletionMarkers.push({
          id,
          beforeBlockId: nextBlockIdForSide(i - 1),
          lineCount: Math.max(1, deletedLineCount),
          groupId,
        });
        if (!firstAnchorId) {
          firstAnchorId = id;
        }
      }
    }

    deleted += runRows.length;
    i -= 1;
  }

  // ── Build ordered hunks and unchanged runs ──
  const hunks: DiffHunk[] = [];
  const unchangedRuns: DiffUnchangedRun[] = [];
  const seenGroupIds = new Set<string>();
  let currentUnchanged: string[] = [];
  const COLLAPSE_THRESHOLD = 4; // minimum unchanged blocks to allow collapsing
  const CONTEXT_BLOCKS = 2; // blocks to keep visible around each hunk

  // Walk the rows to build hunks and unchanged runs in order
  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri];
    if (row.kind === 'equal') {
      const currentBlock = side === 'original' ? row.oldBlock : row.newBlock;
      if (currentBlock) {
        currentUnchanged.push(currentBlock.blockId);
      }
      continue;
    }

    // Flush any accumulated unchanged blocks
    if (currentUnchanged.length > 0) {
      const runId = `wysee-unchanged-${unchangedRuns.length}`;
      unchangedRuns.push({
        id: runId,
        blockIds: [...currentUnchanged],
        blockCount: currentUnchanged.length,
        collapsible: currentUnchanged.length > COLLAPSE_THRESHOLD + CONTEXT_BLOCKS * 2,
        firstBlockId: currentUnchanged[0],
        lastBlockId: currentUnchanged[currentUnchanged.length - 1],
      });
      currentUnchanged = [];
    }

    // Find the groupId for this row's changed content
    const currentBlock = side === 'original' ? row.oldBlock : row.newBlock;
    let groupId: string | undefined;
    if (currentBlock && blocks[currentBlock.blockId]) {
      groupId = blocks[currentBlock.blockId].groupId;
    }
    // Check placeholders and deletion markers for matching groupId if no block on this side
    if (!groupId) {
      // Try to match by scanning nearby placeholders/markers
      for (const p of placeholders) {
        const pBefore = p.beforeBlockId;
        // Check if this placeholder was generated from a row near ri
        if (p.groupId && !seenGroupIds.has(p.groupId)) {
          groupId = p.groupId;
          break;
        }
      }
    }
    if (!groupId) {
      for (const dm of deletionMarkers) {
        if (dm.groupId && !seenGroupIds.has(dm.groupId)) {
          groupId = dm.groupId;
          break;
        }
      }
    }

    if (groupId && !seenGroupIds.has(groupId)) {
      seenGroupIds.add(groupId);

      // Determine anchor: block ID on this side, or placeholder/marker ID
      let anchorId = currentBlock?.blockId ?? '';
      if (!anchorId) {
        const matchingPlaceholder = placeholders.find(p => p.groupId === groupId);
        const matchingMarker = deletionMarkers.find(m => m.groupId === groupId);
        anchorId = matchingPlaceholder?.id ?? matchingMarker?.id ?? '';
      }

      // Determine kind
      let hunkKind: DiffHunk['kind'] = row.kind === 'added' ? 'added' : row.kind === 'deleted' ? 'deleted' : 'modified';
      // Check if the run is mixed (has both added and deleted rows)
      let hasAdded = row.kind === 'added';
      let hasDeleted = row.kind === 'deleted';
      let hasModified = row.kind === 'modified';
      for (let rj = ri + 1; rj < rows.length; rj++) {
        const nextRow = rows[rj];
        if (nextRow.kind === 'equal') break;
        const nextBlock = side === 'original' ? nextRow.oldBlock : nextRow.newBlock;
        const nextGroupId = nextBlock ? blocks[nextBlock.blockId]?.groupId : undefined;
        if (nextGroupId !== groupId) break;
        if (nextRow.kind === 'added') hasAdded = true;
        if (nextRow.kind === 'deleted') hasDeleted = true;
        if (nextRow.kind === 'modified') hasModified = true;
      }
      if ((hasAdded && hasDeleted) || (hasModified && (hasAdded || hasDeleted))) {
        hunkKind = 'mixed';
      }

      hunks.push({
        id: `wysee-hunk-${hunks.length}`,
        index: hunks.length,
        kind: hunkKind,
        anchorId,
        groupId,
      });
    }
  }

  // Flush trailing unchanged
  if (currentUnchanged.length > 0) {
    const runId = `wysee-unchanged-${unchangedRuns.length}`;
    unchangedRuns.push({
      id: runId,
      blockIds: [...currentUnchanged],
      blockCount: currentUnchanged.length,
      collapsible: currentUnchanged.length > COLLAPSE_THRESHOLD + CONTEXT_BLOCKS * 2,
      firstBlockId: currentUnchanged[0],
      lastBlockId: currentUnchanged[currentUnchanged.length - 1],
    });
  }

  return {
    mode,
    side: mode === 'diff' ? side : undefined,
    comparisonLabel,
    readOnly,
    firstAnchorId,
    blocks,
    placeholders,
    deletionMarkers,
    hunks,
    unchangedRuns,
    summary: { added, deleted, modified },
  };
}

function remapInlineTone(ranges: DiffInlineRange[], tone: DiffInlineRange['tone']): DiffInlineRange[] {
  return ranges.map((range) => ({ ...range, tone }));
}

function extractVisibleBlocks(model: RenderViewModel): ComparableBlock[] {
  const { document } = parseHTML(`<body>${model.html}</body>`);
  const nodes = Array.from(document.querySelectorAll('[data-wysee-block-id]'));
  const blocks: ComparableBlock[] = [];

  for (const node of nodes) {
    const blockId = node.getAttribute('data-wysee-block-id');
    if (!blockId) {
      continue;
    }
    const block = model.blocks?.[blockId];
    if (!block || block.kind === 'footnoteDefinition') {
      continue;
    }
    const text = (node.textContent || '').replace(/\u00a0/g, ' ');
    const raw = block.raw || text;
    blocks.push({
      blockId,
      kind: block.kind,
      raw,
      text,
      lineCount: computeLineCount(block.raw || text),
    });
  }

  return blocks;
}

function computeLineCount(text: string): number {
  if (!text) {
    return 1;
  }
  return Math.max(1, text.split(/\r?\n/).length);
}

function blockSignature(block: ComparableBlock): string {
  return `${block.kind}\u0000${normalizeWhitespace(block.raw)}`;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function diffSequence(oldItems: string[], newItems: string[]): SequenceOp[] {
  const table = buildLcsTable(oldItems, newItems);
  const ops: SequenceOp[] = [];
  let i = 0;
  let j = 0;

  while (i < oldItems.length && j < newItems.length) {
    if (oldItems[i] === newItems[j]) {
      ops.push({ type: 'equal', oldIndex: i, newIndex: j });
      i += 1;
      j += 1;
      continue;
    }
    if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: 'delete', oldIndex: i });
      i += 1;
    } else {
      ops.push({ type: 'insert', newIndex: j });
      j += 1;
    }
  }

  while (i < oldItems.length) {
    ops.push({ type: 'delete', oldIndex: i });
    i += 1;
  }
  while (j < newItems.length) {
    ops.push({ type: 'insert', newIndex: j });
    j += 1;
  }

  return ops;
}

function buildLcsTable<T>(oldItems: T[], newItems: T[]): number[][] {
  const table: number[][] = Array.from({ length: oldItems.length + 1 }, () => Array<number>(newItems.length + 1).fill(0));
  for (let i = oldItems.length - 1; i >= 0; i -= 1) {
    for (let j = newItems.length - 1; j >= 0; j -= 1) {
      table[i][j] = oldItems[i] === newItems[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function alignChangedChunk(oldChunk: ComparableBlock[], newChunk: ComparableBlock[]): AlignmentRow[] {
  if (!oldChunk.length) {
    return newChunk.map(block => ({ kind: 'added', newBlock: block }));
  }
  if (!newChunk.length) {
    return oldChunk.map(block => ({ kind: 'deleted', oldBlock: block }));
  }

  const pairings = buildChunkPairings(oldChunk, newChunk);
  const rows: AlignmentRow[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  for (const pairing of pairings) {
    while (oldIndex < pairing.oldIndex) {
      rows.push({ kind: 'deleted', oldBlock: oldChunk[oldIndex] });
      oldIndex += 1;
    }
    while (newIndex < pairing.newIndex) {
      rows.push({ kind: 'added', newBlock: newChunk[newIndex] });
      newIndex += 1;
    }
    const oldBlock = oldChunk[pairing.oldIndex];
    const newBlock = newChunk[pairing.newIndex];
    const { oldRanges, newRanges } = diffTextRanges(oldBlock.text, newBlock.text);
    rows.push({ kind: 'modified', oldBlock, newBlock, oldRanges, newRanges });
    oldIndex = pairing.oldIndex + 1;
    newIndex = pairing.newIndex + 1;
  }

  while (oldIndex < oldChunk.length) {
    rows.push({ kind: 'deleted', oldBlock: oldChunk[oldIndex] });
    oldIndex += 1;
  }
  while (newIndex < newChunk.length) {
    rows.push({ kind: 'added', newBlock: newChunk[newIndex] });
    newIndex += 1;
  }

  return rows;
}

function buildChunkPairings(oldChunk: ComparableBlock[], newChunk: ComparableBlock[]): { oldIndex: number; newIndex: number }[] {
  const thresholdedScores = Array.from({ length: oldChunk.length }, () => Array<number>(newChunk.length).fill(Number.NEGATIVE_INFINITY));
  for (let i = 0; i < oldChunk.length; i += 1) {
    for (let j = 0; j < newChunk.length; j += 1) {
      const score = blockSimilarity(oldChunk[i], newChunk[j]);
      const threshold = oldChunk[i].kind === newChunk[j].kind ? 0.34 : 0.52;
      if (score >= threshold) {
        thresholdedScores[i][j] = score;
      }
    }
  }

  const dp: number[][] = Array.from({ length: oldChunk.length + 1 }, () => Array<number>(newChunk.length + 1).fill(0));

  for (let i = oldChunk.length - 1; i >= 0; i -= 1) {
    for (let j = newChunk.length - 1; j >= 0; j -= 1) {
      let best = Math.max(dp[i + 1][j], dp[i][j + 1]);
      const pairScore = thresholdedScores[i][j];
      if (Number.isFinite(pairScore)) {
        best = Math.max(best, dp[i + 1][j + 1] + pairScore);
      }
      dp[i][j] = best;
    }
  }

  const pairings: { oldIndex: number; newIndex: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < oldChunk.length && j < newChunk.length) {
    const pairScore = thresholdedScores[i][j];
    if (Number.isFinite(pairScore) && dp[i][j] === dp[i + 1][j + 1] + pairScore && dp[i][j] > Math.max(dp[i + 1][j], dp[i][j + 1])) {
      pairings.push({ oldIndex: i, newIndex: j });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  if (!pairings.length && oldChunk.length === 1 && newChunk.length === 1) {
    pairings.push({ oldIndex: 0, newIndex: 0 });
  }

  return pairings;
}

function blockSimilarity(a: ComparableBlock, b: ComparableBlock): number {
  if (blockSignature(a) === blockSignature(b)) {
    return 1;
  }
  const aText = normalizeWhitespace(a.text || a.raw);
  const bText = normalizeWhitespace(b.text || b.raw);
  if (!aText && !bText) {
    return a.kind === b.kind ? 0.8 : 0;
  }
  const tokenScore = diceCoefficient(tokenizeWords(aText), tokenizeWords(bText));
  const bigramScore = diceCoefficient(bigrams(aText), bigrams(bText));
  const kindBoost = a.kind === b.kind ? 0.22 : 0;
  const linePenalty = 1 - Math.min(1, Math.abs(a.lineCount - b.lineCount) / Math.max(a.lineCount, b.lineCount, 1));
  return Math.min(1, tokenScore * 0.45 + bigramScore * 0.25 + linePenalty * 0.08 + kindBoost);
}

function tokenizeWords(value: string): string[] {
  const tokens = value.toLowerCase().match(/[\p{L}\p{N}_-]+/gu);
  return tokens ?? [];
}

function bigrams(value: string): string[] {
  const compact = value.toLowerCase();
  if (compact.length < 2) {
    return compact ? [compact] : [];
  }
  const grams: string[] = [];
  for (let i = 0; i < compact.length - 1; i += 1) {
    grams.push(compact.slice(i, i + 2));
  }
  return grams;
}

function diceCoefficient(left: string[], right: string[]): number {
  if (!left.length && !right.length) {
    return 1;
  }
  if (!left.length || !right.length) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const item of left) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  let overlap = 0;
  for (const item of right) {
    const count = counts.get(item) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(item, count - 1);
    }
  }
  return (2 * overlap) / (left.length + right.length);
}

function diffTextRanges(oldText: string, newText: string): { oldRanges: DiffInlineRange[]; newRanges: DiffInlineRange[] } {
  const oldTokens = tokenizeText(oldText);
  const newTokens = tokenizeText(newText);
  const table = buildLcsTable(oldTokens.map(token => token.value), newTokens.map(token => token.value));
  const oldRanges: DiffInlineRange[] = [];
  const newRanges: DiffInlineRange[] = [];

  let i = 0;
  let j = 0;
  let oldRangeStart: number | undefined;
  let oldRangeEnd = 0;
  let newRangeStart: number | undefined;
  let newRangeEnd = 0;

  const flush = (): void => {
    if (oldRangeStart !== undefined && oldRangeEnd > oldRangeStart) {
      oldRanges.push({ start: oldRangeStart, end: oldRangeEnd, tone: 'removed' });
    }
    if (newRangeStart !== undefined && newRangeEnd > newRangeStart) {
      newRanges.push({ start: newRangeStart, end: newRangeEnd, tone: 'modified' });
    }
    oldRangeStart = undefined;
    oldRangeEnd = 0;
    newRangeStart = undefined;
    newRangeEnd = 0;
  };

  while (i < oldTokens.length && j < newTokens.length) {
    if (oldTokens[i].value === newTokens[j].value) {
      flush();
      i += 1;
      j += 1;
      continue;
    }
    if (table[i + 1][j] >= table[i][j + 1]) {
      oldRangeStart ??= oldTokens[i].start;
      oldRangeEnd = oldTokens[i].end;
      i += 1;
    } else {
      newRangeStart ??= newTokens[j].start;
      newRangeEnd = newTokens[j].end;
      j += 1;
    }
  }
  while (i < oldTokens.length) {
    oldRangeStart ??= oldTokens[i].start;
    oldRangeEnd = oldTokens[i].end;
    i += 1;
  }
  while (j < newTokens.length) {
    newRangeStart ??= newTokens[j].start;
    newRangeEnd = newTokens[j].end;
    j += 1;
  }
  flush();

  return { oldRanges: mergeRanges(oldRanges), newRanges: mergeRanges(newRanges) };
}

function tokenizeText(value: string): { value: string; start: number; end: number }[] {
  const regex = /\s+|[^\s]+/g;
  const tokens: { value: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value))) {
    tokens.push({ value: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function mergeRanges(ranges: DiffInlineRange[]): DiffInlineRange[] {
  if (ranges.length <= 1) {
    return ranges;
  }
  const merged: DiffInlineRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1 && last.tone === range.tone) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}
