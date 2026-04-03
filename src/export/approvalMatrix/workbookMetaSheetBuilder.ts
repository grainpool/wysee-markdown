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
 * WorkbookMetaSheetBuilder — Stage 3
 *
 * Adds image export metadata columns for each hunk row.
 */

import type ExcelJS from 'exceljs';
import { ExportApprovalMatrixSession, HunkCardImages } from './types';

const META_HEADERS = [
  'WorkbookRow', 'HunkId', 'HunkAnchor', 'DocPath',
  'PreviousAnchorId', 'NewAnchorId', 'ChangeKind',
  'ExportTimestamp', 'SchemaVersion', 'ChangeIdPrefix', 'PublishUrl',
  // Context columns (Phase 1)
  'HeadingPathMarkdown', 'BreadcrumbDisplay', 'ContextJson', 'ContextRoles',
  'PreviousLineSpansJson', 'NewLineSpansJson',
  // Git columns (Phase 3 placeholders)
  'GitContextStatus', 'PreviousRevisionHash', 'NewerRevisionHash',
  'TouchingCommitCount', 'TouchingCommitsJson',
  // Image columns
  'PrevImageWidth', 'PrevImageHeight', 'PrevTruncated',
  'CurImageWidth', 'CurImageHeight', 'CurTruncated',
];

export function buildMetaSheet(
  workbook: ExcelJS.Workbook,
  session: ExportApprovalMatrixSession,
  cardImages?: HunkCardImages[],
): void {
  const sheet = workbook.addWorksheet('__WyseeMeta', { state: 'veryHidden' });

  const headerRow = sheet.getRow(1);
  META_HEADERS.forEach((header, i) => {
    headerRow.getCell(i + 1).value = header;
  });
  headerRow.font = { bold: true };
  headerRow.commit();

  const imageMap = new Map<number, HunkCardImages>();
  if (cardImages) {
    for (const ci of cardImages) imageMap.set(ci.hunkIndex, ci);
  }

  for (let i = 0; i < session.rows.length; i++) {
    const row = session.rows[i];
    const workbookRowNumber = i + 2;
    const images = imageMap.get(i);

    const dataRow = sheet.getRow(i + 2);
    dataRow.getCell(1).value = workbookRowNumber;
    dataRow.getCell(2).value = row.hunkId;
    dataRow.getCell(3).value = row.hunkAnchor;
    dataRow.getCell(4).value = session.docPath;
    dataRow.getCell(5).value = row.meta.previousAnchorId ?? '';
    dataRow.getCell(6).value = row.meta.newAnchorId ?? '';
    dataRow.getCell(7).value = row.meta.changeKind;
    dataRow.getCell(8).value = session.createdAt;
    dataRow.getCell(9).value = session.schemaVersion;
    dataRow.getCell(10).value = session.settingsSnapshot.changeIdPrefix;
    dataRow.getCell(11).value = session.publishUrl;
    // Context columns
    dataRow.getCell(12).value = row.meta.headingPathMarkdown ?? '';
    dataRow.getCell(13).value = row.meta.breadcrumbDisplay ?? '';
    dataRow.getCell(14).value = row.meta.contextJson ?? '[]';
    dataRow.getCell(15).value = row.meta.contextRoles ?? '';
    const hunk = session.hunks[i];
    dataRow.getCell(16).value = hunk?.previousLineSpans ? JSON.stringify(hunk.previousLineSpans) : '[]';
    dataRow.getCell(17).value = hunk?.newLineSpans ? JSON.stringify(hunk.newLineSpans) : '[]';
    // Git placeholder columns (Phase 3)
    dataRow.getCell(18).value = hunk?.gitContext?.status ?? '';
    dataRow.getCell(19).value = session.selectedRevisionContext?.previous?.hash ?? '';
    dataRow.getCell(20).value = session.selectedRevisionContext?.newer?.hash ?? '';
    dataRow.getCell(21).value = hunk?.gitContext?.totalCount ?? 0;
    dataRow.getCell(22).value = hunk?.gitContext?.touchingCommits ? JSON.stringify(hunk.gitContext.touchingCommits) : '[]';
    // Image columns
    dataRow.getCell(23).value = images?.previous?.width ?? 0;
    dataRow.getCell(24).value = images?.previous?.height ?? 0;
    dataRow.getCell(25).value = images?.previous?.truncated ? 'true' : 'false';
    dataRow.getCell(26).value = images?.current?.width ?? 0;
    dataRow.getCell(27).value = images?.current?.height ?? 0;
    dataRow.getCell(28).value = images?.current?.truncated ? 'true' : 'false';
    dataRow.commit();
  }
}
