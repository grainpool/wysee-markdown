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
 * ReviewHtmlBuilder
 *
 * Builds a standalone, self-contained review HTML page from the
 * base and current RenderViewModels. The HTML presents a side-by-side
 * rendered diff with hunk anchors, synchronized scrolling, and
 * hash-based navigation.
 *
 * Does NOT depend on the live extension webview runtime.
 */

import { RenderViewModel } from '../../types';
import { alignModels, AlignmentRow } from '../../diff/blockDiff';
import { ExportApprovalMatrixSession, ExportHunkInfo } from './types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildReviewHtml(
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
  session: ExportApprovalMatrixSession,
): string {
  const rows = alignModels(baseModel, currentModel);
  const hunks = session.hunks;

  // Build the side-by-side body from alignment rows
  const { leftHtml, rightHtml } = buildSideBySideContent(rows, hunks, baseModel, currentModel);

  const title = `Review: ${escapeHtml(session.docTitle)}`;
  const docPath = escapeHtml(session.docPath);
  const exportDate = new Date(session.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Collect user's theme CSS and syntax highlighting CSS
  // Scope the theme CSS to .pane-content so it styles block content
  // without clashing with the review layout
  const userPreviewCss = (currentModel.previewCss || '')
    .replace(/\.wysee-root/g, '.pane-content');
  const userSyntaxCss = currentModel.syntaxCss || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${REVIEW_CSS}</style>
<style>/* User theme */\n${userPreviewCss}</style>
${userSyntaxCss ? `<style>/* Syntax highlighting */\n${userSyntaxCss}</style>` : ''}
</head>
<body>
<header class="review-header">
  <h1>${title}</h1>
  <div class="review-meta">
    <span class="review-path">${docPath}</span>
    <span class="review-date">Exported ${escapeHtml(exportDate)}</span>
    <span class="review-count">${hunks.length} change${hunks.length === 1 ? '' : 's'}</span>
  </div>
</header>
<div class="review-container">
  <div class="review-pane review-pane-left" id="pane-left">
    <div class="pane-label">Previous</div>
    <div class="pane-content" id="content-left">${leftHtml}</div>
  </div>
  <div class="review-pane review-pane-right" id="pane-right">
    <div class="pane-label">Current</div>
    <div class="pane-content" id="content-right">${rightHtml}</div>
  </div>
</div>
<script>${REVIEW_JS}</script>
</body>
</html>`;
}

interface SideBySideResult {
  leftHtml: string;
  rightHtml: string;
}

function buildSideBySideContent(
  rows: AlignmentRow[],
  hunks: ExportHunkInfo[],
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
): SideBySideResult {
  const leftParts: string[] = [];
  const rightParts: string[] = [];

  // Build a groupId → hunk mapping from the session hunks
  const groupToHunk = new Map<string, ExportHunkInfo>();
  for (const hunk of hunks) {
    groupToHunk.set(hunk.groupId, hunk);
  }

  // Build a blockId → groupId lookup from both models' diff data
  const blockToGroup = new Map<string, string>();
  if (currentModel.diff?.blocks) {
    for (const [blockId, dec] of Object.entries(currentModel.diff.blocks)) {
      if (dec.groupId && dec.state !== 'unchanged') {
        blockToGroup.set(blockId, dec.groupId);
      }
    }
  }
  if (baseModel.diff?.blocks) {
    for (const [blockId, dec] of Object.entries(baseModel.diff.blocks)) {
      if (dec.groupId && dec.state !== 'unchanged') {
        blockToGroup.set(blockId, dec.groupId);
      }
    }
  }

  // Track which groupId is currently open so we can wrap consecutive blocks in the same group
  let openGroupId: string | null = null;
  const emittedGroups = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (row.kind === 'equal') {
      // Close any open hunk
      if (openGroupId) {
        leftParts.push('</div>');
        rightParts.push('</div>');
        openGroupId = null;
      }

      const leftBlockHtml = row.oldBlock ? getBlockHtml(baseModel, row.oldBlock.blockId) : '';
      const rightBlockHtml = row.newBlock ? getBlockHtml(currentModel, row.newBlock.blockId) : '';
      leftParts.push(`<div class="review-block review-unchanged">${leftBlockHtml}</div>`);
      rightParts.push(`<div class="review-block review-unchanged">${rightBlockHtml}</div>`);
      continue;
    }

    // Changed row — find which groupId this belongs to
    const blockId = row.newBlock?.blockId ?? row.oldBlock?.blockId ?? '';
    const groupId = blockToGroup.get(blockId) ?? '';
    const hunk = groupId ? groupToHunk.get(groupId) : undefined;

    // If this is a new group (or no group found), close old and open new
    if (groupId !== openGroupId) {
      if (openGroupId) {
        leftParts.push('</div>');
        rightParts.push('</div>');
      }

      const anchor = hunk?.hunkAnchor ?? `hunk-orphan-${i}`;
      const hunkIdx = hunk?.index ?? -1;

      if (groupId && !emittedGroups.has(groupId)) {
        emittedGroups.add(groupId);
        leftParts.push(`<div class="review-hunk" id="${escapeHtml(anchor)}" data-hunk-index="${hunkIdx}">`);
        rightParts.push(`<div class="review-hunk" data-hunk-index="${hunkIdx}">`);
      } else {
        // Orphan changed block not in any hunk group — still wrap it
        leftParts.push(`<div class="review-hunk" id="${escapeHtml(anchor)}" data-hunk-index="${hunkIdx}">`);
        rightParts.push(`<div class="review-hunk" data-hunk-index="${hunkIdx}">`);
      }
      openGroupId = groupId || `orphan-${i}`;
    }

    // Render the block content
    if (row.kind === 'modified') {
      const leftBlockHtml = row.oldBlock ? getBlockHtml(baseModel, row.oldBlock.blockId) : '';
      const rightBlockHtml = row.newBlock ? getBlockHtml(currentModel, row.newBlock.blockId) : '';
      leftParts.push(`<div class="review-block review-deleted">${leftBlockHtml}</div>`);
      rightParts.push(`<div class="review-block review-added">${rightBlockHtml}</div>`);
    } else if (row.kind === 'deleted') {
      const leftBlockHtml = row.oldBlock ? getBlockHtml(baseModel, row.oldBlock.blockId) : '';
      leftParts.push(`<div class="review-block review-deleted">${leftBlockHtml}</div>`);
      rightParts.push(`<div class="review-block review-placeholder"></div>`);
    } else if (row.kind === 'added') {
      const rightBlockHtml = row.newBlock ? getBlockHtml(currentModel, row.newBlock.blockId) : '';
      leftParts.push(`<div class="review-block review-placeholder"></div>`);
      rightParts.push(`<div class="review-block review-added">${rightBlockHtml}</div>`);
    }

    // Check if next row continues the same group
    const nextRow = i + 1 < rows.length ? rows[i + 1] : undefined;
    if (!nextRow || nextRow.kind === 'equal') {
      // Next is equal or end — close the hunk
      leftParts.push('</div>');
      rightParts.push('</div>');
      openGroupId = null;
    } else {
      // Next is also changed — check if same group
      const nextBlockId = nextRow.newBlock?.blockId ?? nextRow.oldBlock?.blockId ?? '';
      const nextGroupId = blockToGroup.get(nextBlockId) ?? '';
      if (nextGroupId !== groupId) {
        // Different group — close this one, next iteration opens the new one
        leftParts.push('</div>');
        rightParts.push('</div>');
        openGroupId = null;
      }
    }
  }

  // Close any trailing open hunk
  if (openGroupId) {
    leftParts.push('</div>');
    rightParts.push('</div>');
  }

  return { leftHtml: leftParts.join('\n'), rightHtml: rightParts.join('\n') };
}

function getBlockHtml(model: RenderViewModel, blockId: string): string {
  const block = model.blocks?.[blockId];
  if (block?.html) {
    return block.html;
  }
  // Fallback: try to extract from the full HTML
  return `<div class="review-block-missing">[Block ${escapeHtml(blockId)}]</div>`;
}

// ── Inline CSS ──────────────────────────────────────────────────────

const REVIEW_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html { font-size: 15px; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
  background: #1e1e1e;
  color: #d4d4d4;
  line-height: 1.6;
}
.review-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: #252526;
  border-bottom: 1px solid #3c3c3c;
  padding: .75rem 1.2rem;
}
.review-header h1 {
  font-size: 1rem;
  font-weight: 600;
  color: #cccccc;
  margin-bottom: .25rem;
}
.review-meta {
  display: flex;
  gap: 1.5rem;
  font-size: .78rem;
  color: #858585;
}
.review-container {
  display: flex;
  height: calc(100vh - 4rem);
}
.review-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid #3c3c3c;
}
.review-pane:last-child { border-right: none; }
.pane-label {
  padding: .35rem .75rem;
  font-size: .72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #858585;
  background: #2d2d2d;
  border-bottom: 1px solid #3c3c3c;
  flex-shrink: 0;
}
.pane-content {
  flex: 1;
  overflow-y: auto;
  padding: .75rem 1rem 2rem;
}
.review-block {
  margin: .3rem 0;
  padding: .25rem .5rem;
  border-radius: 4px;
  position: relative;
  min-height: 1.2rem;
}
.review-unchanged {
  /* no extra styling */
}
.review-added {
  background: rgba(46, 160, 67, .15);
  border-left: 3px solid #2ea043;
}
.review-deleted {
  background: rgba(248, 81, 73, .15);
  border-left: 3px solid #f85149;
}
.review-placeholder {
  background: repeating-linear-gradient(
    135deg,
    rgba(127,127,127,.06) 0 10px,
    rgba(127,127,127,.02) 10px 20px
  );
  min-height: 1.6rem;
  border: 1px dashed rgba(127,127,127,.2);
}
.review-hunk {
  position: relative;
  margin: .6rem 0;
  padding: .2rem 0;
  border-radius: 6px;
  scroll-margin-top: 5rem;
}
.review-hunk-focus {
  animation: hunk-flash .9s ease-out;
}
@keyframes hunk-flash {
  0% { box-shadow: inset 0 0 0 2px rgba(56, 139, 253, .8), 0 0 12px rgba(56, 139, 253, .3); }
  100% { box-shadow: inset 0 0 0 2px transparent, 0 0 0 transparent; }
}
/* Minimal fallbacks — user theme CSS handles actual content styling */
.review-block img { max-width: 100%; height: auto; }
.review-block pre { overflow-x: auto; }
`;

// ── Inline JS ───────────────────────────────────────────────────────

const REVIEW_JS = `
(function() {
  var leftPane = document.getElementById('content-left');
  var rightPane = document.getElementById('content-right');
  var syncing = false;

  function syncScroll(source, target) {
    if (syncing) return;
    syncing = true;
    var ratio = source.scrollHeight - source.clientHeight;
    if (ratio > 0) {
      var pct = source.scrollTop / ratio;
      target.scrollTop = pct * (target.scrollHeight - target.clientHeight);
    }
    requestAnimationFrame(function() { syncing = false; });
  }

  leftPane.addEventListener('scroll', function() { syncScroll(leftPane, rightPane); });
  rightPane.addEventListener('scroll', function() { syncScroll(rightPane, leftPane); });

  // Hash navigation
  function navigateToHash() {
    var hash = location.hash.replace('#', '');
    if (!hash) return;
    var target = document.getElementById(hash);
    if (!target) return;

    // Find the matching hunk wrapper on the right pane too
    var idx = target.getAttribute('data-hunk-index');
    var rightHunk = rightPane.querySelector('[data-hunk-index="' + idx + '"]');

    // Scroll the hunk into view in the left pane
    var leftContent = leftPane;
    var leftHunk = target.closest('.pane-content') === leftContent ? target : null;

    if (leftHunk) {
      leftHunk.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (target.closest('.pane-content') === rightPane) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Apply focus flash
    target.classList.add('review-hunk-focus');
    if (rightHunk) rightHunk.classList.add('review-hunk-focus');
    setTimeout(function() {
      target.classList.remove('review-hunk-focus');
      if (rightHunk) rightHunk.classList.remove('review-hunk-focus');
    }, 1000);
  }

  window.addEventListener('hashchange', navigateToHash);
  // Initial hash on load
  if (location.hash) {
    // Delay slightly for layout to settle
    setTimeout(navigateToHash, 200);
  }
})();
`;
