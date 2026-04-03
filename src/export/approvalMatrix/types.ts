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
 * Export Approval Matrix types — Stage 1–3 + Context Overhaul
 */

import { HunkContextBundle, HunkLineSpan } from './context/contextTypes';
export type { HunkContextBundle, HunkLineSpan };

export interface ApprovalMatrixSettings {
  publishUrl: string;
  approvalStatuses: string[];
  hiddenColumns: string[];
  changeIdPrefix: string;
  cardWidth: number;
  cardMaxHeight: number;
}

export interface ApprovalMatrixRow {
  changeNo: string;
  hunkId: string;
  hunkAnchor: string;
  docPathDisplay: string;
  summaryText: string;
  reviewLinkUrl: string;
  reviewLinkText: string;
  approvalDefault: string;
  commentsText: string;
  meta: {
    previousAnchorId?: string;
    newAnchorId?: string;
    sectionPath?: string;             // derived legacy field
    headingPathMarkdown?: string;
    breadcrumbDisplay?: string;
    contextJson?: string;
    contextRoles?: string;
    changeKind: string;
  };
}

/** Phase 3 placeholder: selected revision metadata */
export interface RevisionGitContext {
  token: string;
  status: 'resolved' | 'working-tree' | 'not-applicable' | 'unresolved';
  hash?: string;
  message?: string;
  tags?: string[];
  isWorkingTree?: boolean;
  unresolvedReason?: string;
}

export interface SelectedRevisionContext {
  previous: RevisionGitContext;
  newer: RevisionGitContext;
}

export interface ExportApprovalMatrixSession {
  docPath: string;
  docTitle: string;
  docStem: string;
  publishUrl: string;
  reviewHtmlFileName: string;
  schemaVersion: string;
  createdAt: string;
  hunks: ExportHunkInfo[];
  rows: ApprovalMatrixRow[];
  settingsSnapshot: ApprovalMatrixSettings;
  /** Stage 4 source metadata */
  diffSourceMode?: string;
  previousSourceLabel?: string;
  modifiedSourceLabel?: string;
  /** Phase 3 Git context */
  selectedRevisionContext?: SelectedRevisionContext;
}

export interface ExportHunkInfo {
  id: string;
  index: number;
  kind: 'added' | 'deleted' | 'modified' | 'mixed' | string;
  anchorId: string;
  groupId: string;
  hunkAnchor: string;
  previousBlockIds?: string[];
  newBlockIds?: string[];
  previousLineSpans?: HunkLineSpan[];
  newLineSpans?: HunkLineSpan[];
  context?: HunkContextBundle;
  gitContext?: HunkGitContext;
}

/** Placeholder for Phase 3 Git context */
export interface HunkGitContext {
  status: 'resolved' | 'unresolved' | 'not-applicable';
  touchingCommits: { hash: string; message: string; tags?: string[] }[];
  totalCount: number;
  truncatedCount?: number;
  unresolvedReason?: string;
}

/** PNG capture result for one hunk */
export interface HunkCardImages {
  hunkIndex: number;
  previous: { png: Buffer; width: number; height: number; truncated: boolean } | null;
  current: { png: Buffer; width: number; height: number; truncated: boolean } | null;
}

export const SCHEMA_VERSION = '2.0.0';
export const CARD_WIDTH_DEFAULT = 720;
export const CARD_WIDTH_MIN = 360;
export const CARD_WIDTH_MAX = 960;
export const CARD_HEIGHT_MIN = 48;
export const CARD_HEIGHT_MAX = 2160;

export const DEFAULT_APPROVAL_STATUSES = [
  'Pending',
  'Approved',
  'Needs changes',
  'Not applicable',
];

export const REVIEW_LINK_TEXT = 'Open review';
