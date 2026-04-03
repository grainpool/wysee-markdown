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
 * WorkbookBuilder — Stage 3
 *
 * Visible columns A–H:
 *   A = Change No.
 *   B = Doc path
 *   C = Summary of change
 *   D = Previous Version (image)
 *   E = Change (image)
 *   F = Link to Doc
 *   G = Approval
 *   H = Comments
 *
 * D and E are controlled together by the 'screenshots' hidden-column setting.
 */

import type ExcelJS from 'exceljs';
import { ExportApprovalMatrixSession, HunkCardImages } from './types';
import { buildValidationSheet } from './workbookValidationSheetBuilder';
import { buildMetaSheet } from './workbookMetaSheetBuilder';

interface ColumnDef {
  key: string;
  header: string;
  width: number;
  wrapText: boolean;
  hiddenSettingKey: string;
}

const COLUMNS: ColumnDef[] = [
  { key: 'changeNo',    header: 'Change No.',        width: 12,  wrapText: false, hiddenSettingKey: '' },
  { key: 'docPath',     header: 'Doc path',          width: 40,  wrapText: true,  hiddenSettingKey: 'docPath' },
  { key: 'summary',     header: 'Summary of change', width: 45,  wrapText: true,  hiddenSettingKey: 'summary' },
  { key: 'prevImage',   header: 'Previous Version',  width: 100, wrapText: false, hiddenSettingKey: 'screenshots' },
  { key: 'curImage',    header: 'Change',            width: 100, wrapText: false, hiddenSettingKey: 'screenshots' },
  { key: 'link',        header: 'Link to Doc',       width: 16,  wrapText: false, hiddenSettingKey: 'link' },
  { key: 'approval',    header: 'Approval',          width: 18,  wrapText: false, hiddenSettingKey: 'approval' },
  { key: 'comments',    header: 'Comments',          width: 40,  wrapText: true,  hiddenSettingKey: 'comments' },
];

/** Column indices (1-based) */
const COL = {
  CHANGE_NO: 1, DOC_PATH: 2, SUMMARY: 3,
  PREV_IMAGE: 4, CUR_IMAGE: 5,
  LINK: 6, APPROVAL: 7, COMMENTS: 8,
};

export async function buildWorkbook(
  session: ExportApprovalMatrixSession,
  cardImages?: HunkCardImages[],
): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'Wysee MD';
  workbook.created = new Date(session.createdAt);

  // Create visible Review sheet FIRST
  const sheet = workbook.addWorksheet('Review');

  // Hidden sheets
  const { rangeFormula } = buildValidationSheet(workbook, session.settingsSnapshot.approvalStatuses);
  buildMetaSheet(workbook, session, cardImages);

  const hiddenSet = new Set(session.settingsSnapshot.hiddenColumns);

  // Column setup
  sheet.columns = COLUMNS.map((col) => ({
    key: col.key,
    header: col.header,
    width: col.width,
    hidden: Boolean(col.hiddenSettingKey && hiddenSet.has(col.hiddenSettingKey)),
  }));

  // Header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    if (col.wrapText) {
      cell.alignment = { wrapText: true, vertical: 'middle' };
    }
  });
  headerRow.commit();

  // Freeze first row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Build image lookup
  const imageMap = new Map<number, HunkCardImages>();
  if (cardImages) {
    for (const ci of cardImages) {
      imageMap.set(ci.hunkIndex, ci);
    }
  }

  // Data rows
  for (let i = 0; i < session.rows.length; i++) {
    const rowData = session.rows[i];
    const excelRowNum = i + 2;
    const excelRow = sheet.getRow(excelRowNum);

    // A: Change No.
    excelRow.getCell(COL.CHANGE_NO).value = rowData.changeNo;

    // B: Doc path
    const docPathCell = excelRow.getCell(COL.DOC_PATH);
    docPathCell.value = rowData.docPathDisplay;
    docPathCell.alignment = { wrapText: true, vertical: 'top' };

    // C: Summary
    const summaryCell = excelRow.getCell(COL.SUMMARY);
    summaryCell.value = rowData.summaryText;
    summaryCell.alignment = { wrapText: true, vertical: 'top' };

    // D & E: Images
    const images = imageMap.get(i);
    let maxImageHeight = 0;

    if (images?.previous?.png) {
      const imgId = workbook.addImage({
        base64: images.previous.png.toString('base64'),
        extension: 'png',
      });
      sheet.addImage(imgId, {
        tl: { col: COL.PREV_IMAGE - 1, row: excelRowNum - 1 },
        ext: { width: images.previous.width, height: images.previous.height },
      });
      maxImageHeight = Math.max(maxImageHeight, images.previous.height);
    }

    if (images?.current?.png) {
      const imgId = workbook.addImage({
        base64: images.current.png.toString('base64'),
        extension: 'png',
      });
      sheet.addImage(imgId, {
        tl: { col: COL.CUR_IMAGE - 1, row: excelRowNum - 1 },
        ext: { width: images.current.width, height: images.current.height },
      });
      maxImageHeight = Math.max(maxImageHeight, images.current.height);
    }

    // Adjust row height to fit the taller image
    if (maxImageHeight > 0) {
      // Excel row height is in points (1 point ≈ 1.33 pixels)
      excelRow.height = Math.max(20, Math.ceil(maxImageHeight * 0.75) + 4);
    }

    // F: Link to Doc
    const linkCell = excelRow.getCell(COL.LINK);
    linkCell.value = { text: rowData.reviewLinkText, hyperlink: rowData.reviewLinkUrl };
    linkCell.font = { color: { argb: 'FF0563C1' }, underline: true };

    // G: Approval
    const approvalCell = excelRow.getCell(COL.APPROVAL);
    approvalCell.value = rowData.approvalDefault;
    approvalCell.dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [rangeFormula],
      showErrorMessage: true,
      errorTitle: 'Invalid status',
      error: 'Please select a status from the dropdown.',
    };

    // H: Comments
    const commentsCell = excelRow.getCell(COL.COMMENTS);
    commentsCell.value = rowData.commentsText;
    commentsCell.alignment = { wrapText: true, vertical: 'top' };

    excelRow.commit();
  }

  // Autofilter
  if (session.rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: session.rows.length + 1, column: COLUMNS.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
