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
 * CardHtmlBuilder — Stage 3 (corrected)
 *
 * Builds synthetic diff card HTML for each hunk using the diff presentation's
 * groupId-based block associations. This ensures exact 1:1 correspondence
 * between export session rows and card image pairs.
 *
 * Previous approach (broken): called alignModels() independently and counted
 * consecutive non-equal runs, which could diverge from the diff presentation's
 * hunk grouping after the first few hunks.
 *
 * Current approach: for each hunk, find its blocks by groupId from the diff
 * presentation, render previous/current sides from the two models.
 */

import { RenderViewModel, DiffViewPresentation, DiffBlockDecoration } from '../../types';
import { ExportHunkInfo } from './types';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface CardHtmlPair {
  hunkIndex: number;
  previousHtml: string;
  currentHtml: string;
}

/**
 * Build card HTML pairs for all hunks, driven by the diff model's groupId mapping.
 */
export function buildCardHtmlPairs(
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
  hunks: ExportHunkInfo[],
  cardWidth: number,
  cardMaxHeight: number,
  userCss: string,
): CardHtmlPair[] {
  const diff = currentModel.diff;
  if (!diff) return [];

  const pairs: CardHtmlPair[] = [];

  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
    const hunk = hunks[hunkIndex];
    const groupId = hunk.groupId;

    // Collect blocks belonging to this hunk from the current model's diff
    const currentBlocks = collectBlocksByGroup(diff, groupId, currentModel);
    const previousBlocks = collectPreviousBlocks(diff, groupId, baseModel, currentModel);

    // Use shared context breadcrumb from the canonical bundle
    const sectionHeading = hunk.context?.breadcrumbDisplay || undefined;

    const previousHtml = wrapCard(
      hunk, sectionHeading,
      previousBlocks.length ? previousBlocks : [{ html: '', kind: 'placeholder' as const, tone: 'neutral' as const }],
      'previous', cardWidth, cardMaxHeight, userCss,
    );
    const currentHtml = wrapCard(
      hunk, sectionHeading,
      currentBlocks.length ? currentBlocks : [{ html: '', kind: 'placeholder' as const, tone: 'neutral' as const }],
      'current', cardWidth, cardMaxHeight, userCss,
    );

    pairs.push({ hunkIndex, previousHtml, currentHtml });
  }

  return pairs;
}

interface CardBlock {
  html: string;
  kind: 'owned' | 'placeholder';
  tone: 'deletion' | 'addition' | 'neutral';
}

/**
 * Collect blocks for the CURRENT (new/modified) side of a hunk.
 * These are blocks in the current model whose diff decoration has the matching groupId.
 */
function collectBlocksByGroup(
  diff: DiffViewPresentation,
  groupId: string,
  model: RenderViewModel,
): CardBlock[] {
  const blocks: CardBlock[] = [];

  for (const [blockId, decoration] of Object.entries(diff.blocks)) {
    if (decoration.groupId !== groupId) continue;
    if (decoration.state === 'unchanged') continue;

    const blockData = model.blocks?.[blockId];
    const html = blockData?.html ?? `<p>[Block ${escapeHtml(blockId)}]</p>`;

    blocks.push({
      html,
      kind: 'owned',
      tone: decoration.state === 'deleted' ? 'deletion' : 'addition',
    });
  }

  // Also check placeholders for this group (represent deleted content on this side)
  for (const placeholder of diff.placeholders) {
    if (placeholder.groupId === groupId) {
      // This side shows a placeholder — the real content is on the opposite side
      blocks.push({ html: '', kind: 'placeholder', tone: 'neutral' });
    }
  }

  return blocks;
}

/**
 * Collect blocks for the PREVIOUS (original/base) side of a hunk.
 * For modified blocks: use counterpartBlockId to find the base model's version.
 * For added blocks: no previous content (placeholder).
 * For deleted blocks: the base model has the real content.
 */
function collectPreviousBlocks(
  diff: DiffViewPresentation,
  groupId: string,
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
): CardBlock[] {
  const blocks: CardBlock[] = [];

  for (const [blockId, decoration] of Object.entries(diff.blocks)) {
    if (decoration.groupId !== groupId) continue;
    if (decoration.state === 'unchanged') continue;

    if (decoration.state === 'added') {
      // Added in current → no previous content
      blocks.push({ html: '', kind: 'placeholder', tone: 'neutral' });
    } else if (decoration.state === 'modified' && decoration.counterpartBlockId) {
      // Modified → get the base model's version via counterpart
      const baseBlock = baseModel.blocks?.[decoration.counterpartBlockId];
      const html = baseBlock?.html ?? `<p>[Block ${escapeHtml(decoration.counterpartBlockId)}]</p>`;
      blocks.push({ html, kind: 'owned', tone: 'deletion' });
    } else if (decoration.state === 'deleted') {
      // Deleted from current → the block IS the previous content
      const blockData = currentModel.blocks?.[blockId];
      const html = blockData?.html ?? '';
      if (html) {
        blocks.push({ html, kind: 'owned', tone: 'deletion' });
      }
    } else {
      // Modified without counterpart — try to find in base model directly
      const baseBlock = baseModel.blocks?.[blockId];
      if (baseBlock?.html) {
        blocks.push({ html: baseBlock.html, kind: 'owned', tone: 'deletion' });
      }
    }
  }

  // For placeholders in current model matching this group: the real content is in the base model
  for (const placeholder of diff.placeholders) {
    if (placeholder.groupId !== groupId) continue;
    // The placeholder represents content that exists in the base but not current.
    // Try to find the corresponding blocks in the base model's diff.
    if (baseModel.diff?.blocks) {
      for (const [blockId, baseDec] of Object.entries(baseModel.diff.blocks)) {
        if (baseDec.groupId === groupId && baseDec.state !== 'unchanged') {
          const baseBlock = baseModel.blocks?.[blockId];
          if (baseBlock?.html) {
            blocks.push({ html: baseBlock.html, kind: 'owned', tone: 'deletion' });
          }
        }
      }
    }
  }

  return blocks;
}

function wrapCard(
  hunk: ExportHunkInfo,
  sectionHeading: string | undefined,
  blocks: CardBlock[],
  side: 'previous' | 'current',
  width: number,
  maxHeight: number,
  userCss: string,
): string {
  const sideLabel = side === 'previous' ? 'Previous' : 'Current';
  const hasOwnedContent = blocks.some(b => b.kind === 'owned');

  let bodyHtml: string;
  if (!hasOwnedContent) {
    const label = side === 'previous' ? 'No previous content' : 'Content removed';
    bodyHtml = `<div class="card-placeholder">${escapeHtml(label)}</div>`;
  } else {
    bodyHtml = blocks.map(b => {
      if (b.kind === 'placeholder') {
        return '<div class="card-placeholder-inline"></div>';
      }
      const toneClass = b.tone === 'deletion' ? 'card-deletion' : b.tone === 'addition' ? 'card-addition' : '';
      return `<div class="card-block ${toneClass}">${b.html}</div>`;
    }).join('\n');
  }

  const scopedUserCss = userCss.replace(/\.wysee-root/g, '.card');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
/* User theme (scoped to .card) */
${scopedUserCss}
/* Card structural styles */
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: transparent; }
.card {
  width: ${width}px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(127,127,127,.25);
}
.card-header {
  display: flex;
  align-items: center;
  gap: .5rem;
  padding: .35rem .65rem;
  border-bottom: 1px solid rgba(127,127,127,.2);
  font-size: .72rem;
  opacity: .7;
}
.card-side-label {
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .05em;
}
.card-section {
  opacity: .65;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-body {
  padding: .5rem .65rem;
  max-height: ${maxHeight - 50}px;
  overflow: hidden;
  position: relative;
}
.card-block { margin: .2rem 0; padding: .25rem .4rem; border-radius: 4px; }
.card-deletion {
  background: rgba(248, 81, 73, .15);
  border-left: 3px solid #f85149;
}
.card-addition {
  background: rgba(46, 160, 67, .15);
  border-left: 3px solid #2ea043;
}
.card-placeholder {
  padding: 1rem;
  text-align: center;
  opacity: .5;
  font-style: italic;
  font-size: .85rem;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card-placeholder-inline {
  min-height: 1.2rem;
  background: repeating-linear-gradient(135deg, rgba(127,127,127,.06) 0 10px, rgba(127,127,127,.02) 10px 20px);
  border: 1px dashed rgba(127,127,127,.15);
  border-radius: 3px;
  margin: .2rem 0;
}
.card-overflow-footer {
  padding: .3rem .65rem;
  border-top: 1px solid rgba(127,127,127,.2);
  text-align: center;
  font-size: .72rem;
  opacity: .5;
  font-style: italic;
}
.card-block img { max-width: 100%; height: auto; }
.card-block pre { overflow-x: auto; }
</style>
</head>
<body>
<div class="card" id="card-${hunk.hunkAnchor}-${side}">
  <div class="card-header">
    <span class="card-side-label">${escapeHtml(sideLabel)}</span>
    ${sectionHeading ? `<span class="card-section">${escapeHtml(sectionHeading)}</span>` : ''}
  </div>
  <div class="card-body">${bodyHtml}</div>
</div>
</body>
</html>`;
}
