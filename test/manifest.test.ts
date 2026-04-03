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
import pkg = require('../package.json');

describe('manifest', () => {
  it('contributes Wysee MD as the default custom editor for markdown', () => {
    const editor = pkg.contributes.customEditors.find((item: any) => item.viewType === 'grainpool.wysee-md.editor');
    assert.ok(editor);
    assert.strictEqual(editor.priority, 'default');
    assert.ok(editor.selector.some((item: any) => item.filenamePattern === '*.md'));
  });

  it('declares workspace-only and limited trust capabilities', () => {
    assert.deepStrictEqual(pkg.extensionKind, ['workspace']);
    assert.strictEqual(pkg.capabilities.virtualWorkspaces.supported, false);
    assert.strictEqual(pkg.capabilities.untrustedWorkspaces.supported, 'limited');
  });
});
