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
 * ExportSessionBuilder
 *
 * Produces a normalized ExportApprovalMatrixSession from a document,
 * both rendered models (base + current), and user-supplied settings.
 *
 * The canonical source of truth for section/breadcrumb context is the
 * structured HunkContextBundle captured per hunk. All string forms
 * (sectionPath, docPathDisplay, card headers) are derived from it.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { DiffViewPresentation, RenderViewModel } from '../../types';
import {
  ApprovalMatrixRow,
  ApprovalMatrixSettings,
  ExportApprovalMatrixSession,
  ExportHunkInfo,
  REVIEW_LINK_TEXT,
  SCHEMA_VERSION,
} from './types';
import { captureHunkContext } from './context/contextCapture';
import { serializeBreadcrumbDisplay } from './context/markdownContextSerializer';

export function buildExportSession(
  document: vscode.TextDocument,
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
  settings: ApprovalMatrixSettings,
  publishUrl: string,
): ExportApprovalMatrixSession {
  const docPath = vscode.workspace.asRelativePath(document.uri, false);
  const docStem = path.parse(path.basename(document.uri.fsPath)).name;
  const docTitle = docStem;
  const reviewHtmlFileName = `${slugify(docStem)}-review.html`;
  const createdAt = new Date().toISOString();

  const diff = currentModel.diff;
  const sourceHunks = diff?.hunks ?? [];

  const hunks: ExportHunkInfo[] = sourceHunks.map((hunk, i) => {
    const hunkAnchor = formatHunkAnchor(i);

    // Capture canonical context from both models
    const captured = captureHunkContext({
      groupId: hunk.groupId,
      hunkKind: hunk.kind,
      baseModel,
      currentModel,
    });

    return {
      id: hunk.id,
      index: i,
      kind: hunk.kind,
      anchorId: hunk.anchorId,
      groupId: hunk.groupId,
      hunkAnchor,
      previousBlockIds: captured.previousBlockIds,
      newBlockIds: captured.newBlockIds,
      previousLineSpans: captured.previousLineSpans,
      newLineSpans: captured.newLineSpans,
      context: captured.bundle,
    };
  });

  const rows: ApprovalMatrixRow[] = hunks.map((hunk, i) => {
    const changeNo = formatChangeNo(i + 1, settings.changeIdPrefix);
    const bundle = hunk.context;

    // Derive breadcrumb display with docPath prefix
    const breadcrumbDisplay = bundle
      ? serializeBreadcrumbDisplay({ docPath, nodes: bundle.nodes })
      : docPath;

    // Legacy sectionPath: strip # markers from headingPathMarkdown
    const sectionPath = deriveLegacySectionPath(bundle?.headingPathMarkdown);

    // Visible doc path in workbook: use the breadcrumb display
    const docPathDisplay = breadcrumbDisplay;

    const reviewLinkUrl = publishUrl
      ? `${publishUrl}#${hunk.hunkAnchor}`
      : `./${reviewHtmlFileName}#${hunk.hunkAnchor}`;

    return {
      changeNo,
      hunkId: hunk.id,
      hunkAnchor: hunk.hunkAnchor,
      docPathDisplay,
      summaryText: '',
      reviewLinkUrl,
      reviewLinkText: REVIEW_LINK_TEXT,
      approvalDefault: settings.approvalStatuses[0] ?? 'Pending',
      commentsText: '',
      meta: {
        previousAnchorId: resolveBlockAnchor(hunk, diff, 'original'),
        newAnchorId: resolveBlockAnchor(hunk, diff, 'modified'),
        sectionPath,
        headingPathMarkdown: bundle?.headingPathMarkdown ?? '',
        breadcrumbDisplay: bundle?.breadcrumbDisplay ?? '',
        contextJson: bundle?.contextJson ?? '[]',
        contextRoles: bundle?.contextRoles ?? '',
        changeKind: hunk.kind,
      },
    };
  });

  return {
    docPath,
    docTitle,
    docStem,
    publishUrl,
    reviewHtmlFileName,
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    hunks,
    rows,
    settingsSnapshot: { ...settings },
  };
}

function formatHunkAnchor(index: number): string {
  return `hunk-${String(index + 1).padStart(4, '0')}`;
}

function formatChangeNo(n: number, prefix: string): string {
  return prefix ? `${prefix}${n}` : String(n);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derive legacy sectionPath by stripping heading markers from headingPathMarkdown.
 * Returns the plain text heading path for backward compatibility.
 */
function deriveLegacySectionPath(headingPathMarkdown: string | undefined): string | undefined {
  if (!headingPathMarkdown) return undefined;
  return headingPathMarkdown
    .split(' > ')
    .map(segment => segment.replace(/^#{1,6}\s+/, '').trim())
    .join(' > ') || undefined;
}

function resolveBlockAnchor(
  hunk: ExportHunkInfo,
  diff: DiffViewPresentation | undefined,
  side: 'original' | 'modified',
): string | undefined {
  if (!diff?.blocks) return undefined;
  for (const [blockId, decoration] of Object.entries(diff.blocks)) {
    if (decoration.groupId === hunk.groupId && decoration.state !== 'unchanged') {
      return blockId;
    }
  }
  return undefined;
}
