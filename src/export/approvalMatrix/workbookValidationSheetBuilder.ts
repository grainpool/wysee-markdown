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
 * WorkbookValidationSheetBuilder
 *
 * Creates the hidden __Validation sheet that stores approval status values.
 * Column G validation formulas reference this range.
 */

import type ExcelJS from 'exceljs';

export function buildValidationSheet(
  workbook: ExcelJS.Workbook,
  statuses: string[],
): { sheetName: string; rangeFormula: string } {
  const sheetName = '__Validation';
  const sheet = workbook.addWorksheet(sheetName, { state: 'veryHidden' });

  // Write statuses in column A, starting at row 1
  for (let i = 0; i < statuses.length; i++) {
    sheet.getCell(i + 1, 1).value = statuses[i];
  }

  // The range formula for data validation
  const rangeFormula = `'${sheetName}'!$A$1:$A$${statuses.length}`;

  return { sheetName, rangeFormula };
}
