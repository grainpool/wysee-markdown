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
import * as fs from 'fs/promises';
import * as path from 'path';
import { Uri } from 'vscode';
import { __registerDocument } from 'vscode';
import { buildBlockMap } from '../src/render/blockMap';
import { buildDocumentStats } from '../src/analysis/markdownStats';

const baseDir = '/tmp/wysee-stats-tests';

describe('markdown stats and dangling references', () => {
  it('counts advanced stats and ignores code spans when checking dangling references', async () => {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'exists.png'), Buffer.from([137, 80, 78, 71]));

    const text = [
      '# Title',
      '',
      'Paragraph text.',
      '![Alt](.png){width=100%, align=center}',
      '[inline link](#)',
      '[bad](https://.com)',
      '![good](./exists.png)',
      '`![ignore-me](missing-inline.png)` and `[ignore-link](#)`',
      '```md',
      '![ignore-fence](missing-fence.png)',
      '[ignore-anchor](#)',
      '```',
      '[^missing]',
      '[^empty]',
      '',
      '[^empty]:',
      '',
      '[refbad]: https://.com',
      'Using [bad ref][refbad].',
      '',
      '## Child section',
      'More words here.',
    ].join('\n');

    const uri = Uri.file(path.join(baseDir, 'doc.md'));
    const doc: any = __registerDocument(uri, text, 'markdown');
    const stats = await buildDocumentStats(doc, buildBlockMap(doc), 1);

    assert.strictEqual(stats.wordCount > 0, true);
    assert.strictEqual(stats.characterCountWithMarkup, text.length);
    assert.strictEqual(stats.imageCount, 2);
    assert.strictEqual(stats.sectionDepth, 1);
    assert.strictEqual(stats.sections.length >= 1, true);
    assert.strictEqual(stats.danglingReferenceCount, 6);

    const messages = stats.danglingIssues.map((item) => item.message);
    assert.ok(messages.includes('Referenced local file does not exist.'));
    assert.ok(messages.includes('Empty anchor destination.'));
    assert.ok(messages.includes('Invalid URL hostname.'));
    assert.ok(messages.includes('Missing footnote definition.'));
    assert.ok(messages.includes('Footnote definition has no content.'));

    const issueLines = stats.danglingIssues.map((item) => item.line + 1);
    assert.ok(!issueLines.includes(10));
    assert.ok(!issueLines.includes(11));
  });
});
