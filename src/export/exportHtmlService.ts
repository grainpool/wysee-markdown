import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseHTML } from 'linkedom';
import { MarkdownRenderer } from '../render/markdownRenderer';
import { TraceService } from '../diagnostics/trace';
import { resolveRelativePath } from '../util/uris';

export class ExportHtmlService {
  constructor(private readonly renderer: MarkdownRenderer, private readonly trace: TraceService) {}

  async exportHtml(uri: vscode.Uri, _themeId: string | undefined, _pageProfileId: string | undefined, targetUri: vscode.Uri): Promise<void> {
    const selfContained = vscode.workspace.getConfiguration('wyseeMd', uri).get<boolean>('export.html.selfContained', false);
    const document = await vscode.workspace.openTextDocument(uri);
    let html = await this.renderer.buildStandaloneHtml(document, 'export', vscode.workspace.isTrusted);
    if (!selfContained) {
      html = await this.rewriteAssets(document, targetUri, html);
    }
    await fs.writeFile(targetUri.fsPath, html, 'utf8');
    this.trace.info('Exported HTML', { uri: targetUri.toString(), selfContained });
  }

  private async rewriteAssets(document: vscode.TextDocument, targetUri: vscode.Uri, html: string): Promise<string> {
    const assetDirName = `${path.basename(targetUri.fsPath, path.extname(targetUri.fsPath))}_wysee-assets`;
    const assetDir = path.join(path.dirname(targetUri.fsPath), assetDirName);
    await fs.mkdir(assetDir, { recursive: true });
    const { document: dom } = parseHTML(html);
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
      const destName = `${index}-${path.basename(resolved.fsPath)}`;
      await fs.copyFile(resolved.fsPath, path.join(assetDir, destName));
      img.setAttribute('src', `${assetDirName}/${destName}`);
      index += 1;
    }
    return dom.toString();
  }
}
