import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseHTML } from 'linkedom';
import { randomUUID } from 'crypto';
import { MarkdownRenderer } from '../render/markdownRenderer';
import { PrintBundle } from '../types';
import { TraceService } from '../diagnostics/trace';
import { ThemeService } from '../theme/themeService';
import { PageProfileService } from '../theme/pageProfileService';
import { resolveRelativePath, uriBasename } from '../util/uris';
import { BrowserPrintTransportManager } from './browserPrintTransportManager';
import { ExternalPrintServer } from './externalPrintServer';
import { ERROR_CODES } from '../diagnostics/errorCodes';

export class PrintBundleService {
  constructor(
    private readonly renderer: MarkdownRenderer,
    private readonly themeService: ThemeService,
    private readonly pageProfileService: PageProfileService,
    private readonly printServer: ExternalPrintServer,
    private readonly transportManager: BrowserPrintTransportManager,
    private readonly trace: TraceService,
  ) {}

  async buildPrintBundle(uri: vscode.Uri, themeId?: string, pageProfileId?: string, mode: 'print' | 'pdf' = 'print'): Promise<PrintBundle> {
    const document = await vscode.workspace.openTextDocument(uri);
    const model = await this.renderer.renderDocumentToViewModel(document, { mode: 'print', trusted: vscode.workspace.isTrusted });
    const printProfile = await this.pageProfileService.getActivePageProfile(uri);

    // Resolve linked document style: if the print profile has a printStyle field, use that style for CSS
    let themeCss = model.previewCss;
    if ((printProfile as any).printStyle) {
      const linked = await this.themeService.getThemeById((printProfile as any).printStyle, uri);
      if (linked) {
        themeCss = this.themeService.compileThemeToPreviewCss(linked);
      }
    }
    const pageCss = this.pageProfileService.compileThemeToPrintCss(
      (printProfile as any).printStyle ? (await this.themeService.getThemeById((printProfile as any).printStyle, uri)) ?? await this.themeService.getActiveTheme(uri) : await this.themeService.getActiveTheme(uri),
      printProfile,
    );

    const jobId = randomUUID();
    const token = randomUUID().replace(/-/g, '');
    const { html, assets } = await this.rewriteAssets(document, model.html);
    const printCss = await fs.readFile(path.join(this.themeService.extensionPath, 'media', 'print-page.css'), 'utf8');
    const printJs = await fs.readFile(path.join(this.themeService.extensionPath, 'media', 'print-page.js'), 'utf8');
    const mermaidJs = await fs.readFile(path.join(this.themeService.extensionPath, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'), 'utf8');
    let katexCss = '';
    let katexJs = '';
    try {
      katexCss = await fs.readFile(path.join(this.themeService.extensionPath, 'node_modules', 'katex', 'dist', 'katex.min.css'), 'utf8');
      katexJs = await fs.readFile(path.join(this.themeService.extensionPath, 'node_modules', 'katex', 'dist', 'katex.min.js'), 'utf8');
    } catch { /* katex optional */ }
    let hljsCss = '';
    try {
      hljsCss = await fs.readFile(path.join(this.themeService.extensionPath, 'node_modules', 'highlight.js', 'styles', 'github-dark.min.css'), 'utf8');
    } catch { /* highlight.js optional */ }
    const title = `${path.parse(uriBasename(uri)).name}.pdf`;
    const pageNumbersConfig = (printProfile as any).pageNumbers ?? null;
    const htmlDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<link rel="stylesheet" href="app.css" />
</head>
<body data-wysee-mode="${mode}"${pageNumbersConfig?.suppressFirstPage ? ' class="wysee-suppress-first-page"' : ''}>
<div class="wysee-print-banner">${mode === 'pdf' ? 'Use your browser’s Save to PDF / Print to PDF destination.' : 'Preparing the browser print dialog…'}</div>
<div id="wysee-root">${html}</div>
${pageNumbersConfig?.enabled ? '<div class="wysee-page-number-footer" id="wysee-page-num"></div>' : ''}
<button id="wysee-print-now" hidden>Print now</button>
<script src="app.js"></script>
</body>
</html>`;
    return {
      jobId,
      token,
      title,
      html: htmlDoc,
      css: `${themeCss}\n${pageCss}\n${printCss}\n${katexCss}\n${hljsCss}\n${model.syntaxCss ?? ''}`,
      js: `window.__WYSEE_TITLE__=${JSON.stringify(title)};\nwindow.__WYSEE_MODE__=${JSON.stringify(mode)};\nwindow.__WYSEE_PAGE_NUMBERS__=${JSON.stringify(pageNumbersConfig)};\n${mermaidJs}\n${katexJs}\n${printJs}`,
      assets,
      pageProfileId: pageProfileId ?? model.activePageProfileId,
      themeId: themeId ?? model.activeThemeId,
    };
  }

  async printDocument(uri: vscode.Uri, themeId?: string, pageProfileId?: string): Promise<void> {
    await this.assertTrusted();
    await this.printServer.ensureStarted();
    const bundle = await this.buildPrintBundle(uri, themeId, pageProfileId, 'print');
    const url = this.printServer.createJob(bundle);
    const launch = await this.transportManager.open(url);
    this.trace.info('Print launch result', launch);
    if (!launch.launched) {
      throw new Error(`${ERROR_CODES.printLaunchFailed}: ${launch.detail}`);
    }
  }

  async exportPdfViaBrowserDialog(uri: vscode.Uri, themeId?: string, pageProfileId?: string): Promise<void> {
    await this.assertTrusted();
    await this.printServer.ensureStarted();
    const bundle = await this.buildPrintBundle(uri, themeId, pageProfileId, 'pdf');
    const url = this.printServer.createJob(bundle);
    const launch = await this.transportManager.open(url);
    this.trace.info('PDF browser launch result', launch);
    if (!launch.launched) {
      throw new Error(`${ERROR_CODES.printLaunchFailed}: ${launch.detail}`);
    }
  }

  private async rewriteAssets(document: vscode.TextDocument, html: string): Promise<{ html: string; assets: PrintBundle['assets'] }> {
    const { document: dom } = parseHTML(`<html><body>${html}</body></html>`);
    const assets: PrintBundle['assets'] = [];
    let index = 0;
    for (const img of Array.from(dom.querySelectorAll('img'))) {
      const src = img.getAttribute('src') || '';
      if (!src || /^https?:/i.test(src) || /^data:/i.test(src)) {
        continue;
      }
      const resolved = resolveRelativePath(document.uri, src);
      if (!resolved) {
        continue;
      }
      try {
        const body = await fs.readFile(resolved.fsPath);
        const route = `asset/${index}-${path.basename(resolved.fsPath)}`;
        assets.push({ route, body, contentType: mimeForFile(resolved.fsPath) });
        img.setAttribute('src', route);
        index += 1;
      } catch (error) {
        this.trace.warn('Print asset missing', { src, error: String(error) });
      }
    }
    return { html: dom.body.innerHTML, assets };
  }

  private async assertTrusted(): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      throw new Error(`${ERROR_CODES.trustRequired}: Browser print and PDF export require a trusted workspace.`);
    }
  }
}

function mimeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}
