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

  async exportPdfToFile(uri: vscode.Uri, themeId?: string, pageProfileId?: string): Promise<void> {
    await this.assertTrusted();

    // 1. Show native save dialog
    const defaultName = path.parse(uriBasename(uri)).name + '.pdf';
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(path.dirname(uri.fsPath), defaultName)),
      filters: { 'PDF': ['pdf'] },
      title: 'Save PDF',
    });
    if (!target) return; // cancelled

    // 2. Find a Chromium-based browser for headless rendering
    const chromePath = await this.findChromiumExecutable();
    if (!chromePath) {
      // Fall back to browser dialog with a notification
      this.trace.info('No Chromium browser found for headless PDF, falling back to browser dialog');
      await vscode.window.showInformationMessage(
        'No Chrome/Chromium/Edge browser was found for direct PDF export. Opening browser print dialog instead.',
        'OK',
      );
      return this.exportPdfViaBrowserDialog(uri, themeId, pageProfileId);
    }

    // 3. Build the bundle and serve it
    await this.printServer.ensureStarted();
    const bundle = await this.buildPrintBundle(uri, themeId, pageProfileId, 'pdf');
    const url = this.printServer.createJob(bundle);

    // 4. Run headless Chrome to generate the PDF
    const outputPath = target.fsPath;
    this.trace.info('Headless PDF export', { chromePath, outputPath, url });

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Saving PDF…', cancellable: false },
      async () => {
        await this.runHeadlessPdf(chromePath, url, outputPath);
      },
    );

    // 5. Verify and notify
    try {
      await fs.access(outputPath);
      const openAction = await vscode.window.showInformationMessage(
        `PDF saved to ${path.basename(outputPath)}`,
        'Open File',
        'Open Folder',
      );
      if (openAction === 'Open File') {
        await vscode.env.openExternal(target);
      } else if (openAction === 'Open Folder') {
        await vscode.env.openExternal(vscode.Uri.file(path.dirname(outputPath)));
      }
    } catch {
      throw new Error('PDF export failed — the output file was not created. Ensure Chrome or Chromium is installed.');
    }
  }

  private async runHeadlessPdf(chromePath: string, url: string, outputPath: string): Promise<void> {
    const { spawn: spawnProc } = await import('child_process');
    return new Promise<void>((resolve, reject) => {
      const args = [
        '--headless=new',
        '--disable-gpu',
        '--no-pdf-header-footer',
        `--print-to-pdf=${outputPath}`,
        '--virtual-time-budget=10000',
        '--run-all-compositor-stages-before-draw',
        '--disable-extensions',
        '--no-first-run',
        '--disable-default-apps',
        url,
      ];
      const child = spawnProc(chromePath, args, { stdio: 'pipe' });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Headless PDF export timed out after 30 seconds.'));
      }, 30000);
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          this.trace.warn('Headless Chrome exited with errors', { code, stderr: stderr.slice(0, 500) });
          // Chrome often exits with non-zero but still produces the PDF
          resolve();
        }
      });
    });
  }

  private async findChromiumExecutable(): Promise<string | null> {
    const config = vscode.workspace.getConfiguration('wyseeMd');
    const browserPath = config.get<string>('print.browserPath', '');
    if (browserPath) {
      try {
        await fs.access(browserPath);
        return browserPath;
      } catch { /* configured path not found */ }
    }

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    const candidates = process.platform === 'win32'
      ? [
          process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)']!, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)']!, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ].filter(Boolean) as string[]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['google-chrome', 'chromium', 'chromium-browser', 'msedge', 'microsoft-edge'];

    for (const candidate of candidates) {
      try {
        if (path.isAbsolute(candidate)) {
          await fs.access(candidate);
          return candidate;
        } else {
          // Check if command is on PATH
          const whichCmd = process.platform === 'win32' ? 'where' : 'which';
          const { stdout } = await execFileAsync(whichCmd, [candidate]);
          if (stdout.trim()) return stdout.trim().split('\n')[0];
        }
      } catch { /* next candidate */ }
    }
    return null;
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
