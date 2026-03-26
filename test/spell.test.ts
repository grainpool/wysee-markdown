import * as assert from 'assert';
import { Uri } from 'vscode';
import { __createTextDocument } from 'vscode';
import { SpellService } from '../src/spell/spellService';
import { SpellCodeActionProvider } from '../src/spell/spellCodeActions';
import { TraceService } from '../src/diagnostics/trace';

const context: any = { extensionPath: process.cwd(), extensionUri: Uri.file(process.cwd()), globalStorageUri: Uri.file('/tmp/wysee-test-global-spell'), workspaceState: { update: async () => undefined }, globalState: { update: async () => undefined } };

describe('spell diagnostics and code actions', () => {
  it('flags simple misspellings and offers replacements', async () => {
    const spell = new SpellService(context, new TraceService());
    await spell.initialize();
    const doc: any = __createTextDocument(Uri.file('/tmp/spell.md'), 'This is teh sample.\n', 'markdown');
    const result = await spell.runSpellcheck(doc);
    assert.ok(result.diagnostics.some((item) => item.word === 'teh'));
    const provider = new SpellCodeActionProvider(spell);
    const actions = await provider.provideCodeActions(doc, result.diagnostics[0].range);
    assert.ok(actions.some((item) => item.title.includes('Replace with')));
  });
});
