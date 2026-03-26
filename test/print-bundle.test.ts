import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Uri } from 'vscode';
import { __createTextDocument, __registerDocument } from 'vscode';
import { MarkdownRenderer } from '../src/render/markdownRenderer';
import { ThemeService } from '../src/theme/themeService';
import { PageProfileService } from '../src/theme/pageProfileService';
import { SpellService } from '../src/spell/spellService';
import { StyleManager } from '../src/style/styleManager';
import { TraceService } from '../src/diagnostics/trace';
import { PrintBundleService } from '../src/print/printBundleService';
import { BrowserPrintTransportManager } from '../src/print/browserPrintTransportManager';
import { ExternalPrintServer } from '../src/print/externalPrintServer';

const baseDir = '/tmp/wysee-print-bundle';
const context: any = { extensionPath: process.cwd(), extensionUri: Uri.file(process.cwd()), globalStorageUri: Uri.file('/tmp/wysee-test-global-print'), workspaceState: { update: async () => undefined }, globalState: { update: async () => undefined } };

describe('print bundle generation', () => {
  it('rewrites local image assets into served bundle assets', async () => {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, 'img.png'), Buffer.from([137,80,78,71]));
    const uri = Uri.file(path.join(baseDir, 'doc.md'));
    const doc: any = __registerDocument(uri, '![Alt](./img.png){width=50%, align=center}\n', 'markdown');
    const trace = new TraceService();
    const styleManager = new StyleManager(context, trace);
    const themeService = new ThemeService(context, trace, styleManager);
    const pageService = new PageProfileService(context, trace, styleManager);
    const spell = new SpellService(context, trace);
    await Promise.all([themeService.initialize(), pageService.initialize(), spell.initialize()]);
    const renderer = new MarkdownRenderer({ trace, themeService, pageProfileService: pageService, spellService: spell });
    const service = new PrintBundleService(renderer, themeService, pageService, new ExternalPrintServer(trace), new BrowserPrintTransportManager(trace), trace);
    const bundle = await service.buildPrintBundle(uri);
    assert.ok(bundle.assets.length >= 1);
    assert.ok(bundle.html.includes('asset/0-'));
  });
});
