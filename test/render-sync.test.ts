import * as assert from 'assert';
import { Uri } from 'vscode';
import { __createTextDocument } from 'vscode';
import { MarkdownRenderer } from '../src/render/markdownRenderer';
import { ThemeService } from '../src/theme/themeService';
import { PageProfileService } from '../src/theme/pageProfileService';
import { SpellService } from '../src/spell/spellService';
import { StyleManager } from '../src/style/styleManager';
import { TraceService } from '../src/diagnostics/trace';
import * as vscode from 'vscode';

const context: any = { extensionPath: process.cwd(), extensionUri: Uri.file(process.cwd()), globalStorageUri: Uri.file('/tmp/wysee-test-global'), workspaceState: { update: async () => undefined }, globalState: { update: async () => undefined } };

describe('source to canvas rendering', () => {
  it('rerenders changed source content', async () => {
    const trace = new TraceService();
    const styleManager = new StyleManager(context, trace);
    const themeService = new ThemeService(context, trace, styleManager);
    const pageService = new PageProfileService(context, trace, styleManager);
    const spell = new SpellService(context, trace);
    await Promise.all([themeService.initialize(), pageService.initialize(), spell.initialize()]);
    const renderer = new MarkdownRenderer({ trace, themeService, pageProfileService: pageService, spellService: spell });
    const doc: any = __createTextDocument(Uri.file('/tmp/render.md'), '# Old\n\nText\n', 'markdown');
    const first = await renderer.renderDocumentToViewModel(doc, { mode: 'webview', trusted: true });
    doc.__setText('# New\n\nText\n');
    const second = await renderer.renderDocumentToViewModel(doc, { mode: 'webview', trusted: true });
    assert.notStrictEqual(first.html, second.html);
    assert.ok(second.html.includes('New'));
  });
});
