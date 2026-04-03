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

import * as assert from 'assert';
import { Uri } from 'vscode';
import { __createTextDocument } from 'vscode';
import { buildBlockMap } from '../src/render/blockMap';
import { planBlockReplacement } from '../src/source/editPlanner';

describe('block edit round-trip', () => {
  it('preserves heading markers', () => {
    const doc: any = __createTextDocument(Uri.file('/tmp/test.md'), '# Hello\n', 'markdown');
    const block = buildBlockMap(doc)[0];
    const next = planBlockReplacement(block, { blockId: block.blockId, documentVersion: 1, editKind: 'text', value: 'World' } as any);
    assert.strictEqual(next, '# World');
  });

  it('updates markdown table cells without touching the alignment row', () => {
    const text = '| Name | Value |\n| --- | --- |\n| A | B |\n';
    const doc: any = __createTextDocument(Uri.file('/tmp/table.md'), text, 'markdown');
    const block = buildBlockMap(doc).find((item) => item.kind === 'table')!;
    const next = planBlockReplacement(block, { blockId: block.blockId, documentVersion: 1, editKind: 'tableCell', row: 1, col: 1, value: 'Updated' } as any);
    assert.ok(next.includes('| A | Updated |'));
    assert.ok(next.includes('| --- | --- |'));
  });
});
