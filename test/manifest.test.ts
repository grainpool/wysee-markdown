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
