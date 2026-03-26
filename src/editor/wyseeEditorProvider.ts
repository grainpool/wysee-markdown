import * as path from 'path';
import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import { VIEWTYPE_EDITOR } from '../constants';
import { TraceService } from '../diagnostics/trace';
import { MarkdownRenderer, preprocessMath } from '../render/markdownRenderer';
import { buildFootnoteRegistryFromText, resolveFootnoteReferences, renderFootnotesSection } from '../render/markdownRenderer';
import { renderMermaidBlock } from '../render/mermaidTransform';
import { BlockEditService } from '../source/blockEditService';
import { ContextStateService } from './contextState';
import { PreviewSessionState } from '../types';
import { WyseeEditorSession } from './wyseeEditorSession';
import { WebviewToExtensionMessage } from './webviewProtocol';
import { SpellService } from '../spell/spellService';
import { buildBlockMap } from '../render/blockMap';
import { debounce } from '../util/debounce';
import { escapeHtml } from '../util/strings';

export class WyseeEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private readonly sessions = new Map<string, WyseeEditorSession>();
  private readonly sessionsByDocument = new Map<string, Set<string>>();
  private readonly disposables: vscode.Disposable[] = [];
  private lastActiveSessionId?: string;
  private readonly debouncedRefresh = debounce((uri: string) => void this.refreshUri(vscode.Uri.parse(uri)), 120);
  private syncScrollEnabled = true;
  private scrollDriver: 'none' | 'source' | 'webview' = 'none';
  private scrollDriverTimer?: ReturnType<typeof setTimeout>;

  private claimScrollDriver(who: 'source' | 'webview') {
    this.scrollDriver = who;
    clearTimeout(this.scrollDriverTimer);
    this.scrollDriverTimer = setTimeout(() => { this.scrollDriver = 'none'; }, 500);
  }
  private readonly previewMd = (() => {
    let highlightFn: ((code: string, lang: string) => string) | undefined;
    try {
      const hljs = require('highlight.js');
      highlightFn = (code: string, lang: string): string => {
        if (lang && hljs.getLanguage(lang)) {
          try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* */ }
        }
        return '';
      };
    } catch { /* highlight.js optional */ }
    const md = new MarkdownIt({ html: true, linkify: true, highlight: highlightFn });
    md.use(markdownItTaskLists, { enabled: true, label: true });
    return md;
  })();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly renderer: MarkdownRenderer,
    private readonly blockEditService: BlockEditService,
    private readonly contextState: ContextStateService,
    private readonly spellService: SpellService,
    private readonly trace: TraceService,
  ) {
    this.syncScrollEnabled = vscode.workspace.getConfiguration('wyseeMd').get<boolean>('preview.syncScroll', true);
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId !== 'markdown') { return; }
        this.debouncedRefresh(event.document.uri.toString());
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        void this.contextState.markMarkdownSourceActive(Boolean(editor && editor.document.languageId === 'markdown'));
      }),
      // Source editor scroll -> webview: send top visible line directly
      vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
        if (!this.syncScrollEnabled) return;
        if (this.scrollDriver === 'webview') return;
        const editor = event.textEditor;
        if (editor.document.languageId !== 'markdown') return;
        const session = this.findSessionForUri(editor.document.uri);
        if (!session || !session.model) return;
        const topLine = event.visibleRanges[0]?.start.line ?? 0;
        const lastLine = (session as any)._lastSourceScrollLine ?? -1;
        if (Math.abs(topLine - lastLine) < 0.5) return;
        (session as any)._lastSourceScrollLine = topLine;
        this.claimScrollDriver('source');
        session.panel.webview.postMessage({ type: 'scrollToSourceLine', line: topLine });
      }),
      // Source editor cursor -> webview block highlight only (no scroll)
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (!this.syncScrollEnabled) return;
        if (this.scrollDriver === 'webview') return;
        const editor = event.textEditor;
        if (editor.document.languageId !== 'markdown') return;
        if (event.kind === vscode.TextEditorSelectionChangeKind.Command) return;
        const session = this.findSessionForUri(editor.document.uri);
        if (!session || !session.model) return;
        const cursorLine = event.selections[0]?.active.line ?? 0;
        const blocks = session.model.blockMap ?? [];
        let best = blocks[0];
        for (const b of blocks) {
          if (b.startLine <= cursorLine && cursorLine <= b.endLine) { best = b; break; }
          if (b.startLine <= cursorLine) best = b;
        }
        if (best) {
          session.panel.webview.postMessage({ type: 'highlightBlock', blockId: best.blockId });
        }
      }),
    );
  }

  static register(
    context: vscode.ExtensionContext,
    renderer: MarkdownRenderer,
    blockEditService: BlockEditService,
    contextState: ContextStateService,
    spellService: SpellService,
    trace: TraceService,
  ): WyseeEditorProvider {
    const provider = new WyseeEditorProvider(context, renderer, blockEditService, contextState, spellService, trace);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(VIEWTYPE_EDITOR, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: true },
      }),
      provider,
    );
    return provider;
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  getActiveSession(): WyseeEditorSession | undefined {
    return this.lastActiveSessionId ? this.sessions.get(this.lastActiveSessionId) : undefined;
  }

  getSessionById(sessionId: string): WyseeEditorSession | undefined {
    return this.sessions.get(sessionId);
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    this.trace.info('Resolve custom text editor', { uri: document.uri.toString() });
    const sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const state: PreviewSessionState = {
      sessionId, uri: document.uri.toString(), documentVersion: document.version, hasSelection: false,
    };
    const session: WyseeEditorSession = { sessionId, document, panel, state };
    this.sessions.set(sessionId, session);
    const bucket = this.sessionsByDocument.get(document.uri.toString()) ?? new Set<string>();
    bucket.add(sessionId);
    this.sessionsByDocument.set(document.uri.toString(), bucket);
    this.lastActiveSessionId = sessionId;

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'mermaid', 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'katex', 'dist'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'highlight.js'),
        vscode.Uri.file(path.dirname(document.uri.fsPath)),
      ],
    };
    panel.webview.html = this.getHtml(panel.webview, sessionId);

    panel.onDidDispose(() => {
      this.sessions.delete(sessionId);
      bucket.delete(sessionId);
      if (this.lastActiveSessionId === sessionId) {
        this.lastActiveSessionId = [...this.sessions.keys()].pop();
      }
      void this.contextState.applySession(this.getActiveSession()?.state, this.isEditable(document.uri), this.browserPrintAvailable());
    }, null, this.context.subscriptions);

    panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.lastActiveSessionId = sessionId;
        void this.contextState.applySession(session.state, this.isEditable(document.uri), this.browserPrintAvailable());
      }
    }, null, this.context.subscriptions);

    panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
      void this.onMessage(session, message);
    }, null, this.context.subscriptions);

    await this.refreshSession(session);
    await this.spellService.runSpellcheck(document);
  }

  async refreshUri(uri: vscode.Uri): Promise<void> {
    const ids = this.sessionsByDocument.get(uri.toString());
    if (!ids) { return; }
    for (const id of ids) {
      const session = this.sessions.get(id);
      if (session) { await this.refreshSession(session); }
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await this.spellService.runSpellcheck(doc);
  }

  async refreshAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      await this.refreshSession(session);
    }
  }

  async openSourceToSide(uri: vscode.Uri): Promise<void> {
    const session = this.findSessionForUri(uri);
    const topLine = session?.state.scrollTopLine ?? 0;
    const editor = await vscode.commands.executeCommand('vscode.openWith', uri, 'default', { viewColumn: vscode.ViewColumn.Beside, preview: false }) as vscode.TextEditor | undefined;
    // Scroll source editor to the line corresponding to the WYSIWYG viewport top
    if (topLine > 0) {
      setTimeout(() => {
        const sourceEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
        if (sourceEditor) {
          const range = new vscode.Range(topLine, 0, topLine, 0);
          sourceEditor.revealRange(range, vscode.TextEditorRevealType.AtTop);
        }
      }, 150);
    }
  }

  async toggleEditable(uri?: vscode.Uri): Promise<boolean> {
    const targetUri = uri ?? this.getActiveSession()?.document.uri;
    const config = vscode.workspace.getConfiguration('wyseeMd', targetUri);
    const next = !config.get<boolean>('preview.editable', true);
    const folder = targetUri ? vscode.workspace.getWorkspaceFolder(targetUri) : undefined;
    await config.update('preview.editable', next, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
    await this.refreshAll();
    return next;
  }

  private async refreshSession(session: WyseeEditorSession): Promise<void> {
    const model = await this.renderer.renderDocumentToViewModel(session.document, {
      mode: 'webview', trusted: vscode.workspace.isTrusted, webview: session.panel.webview,
    });
    session.state.documentVersion = session.document.version;
    session.model = model;
    session.panel.webview.postMessage({ type: 'render', model });
    if (this.lastActiveSessionId === session.sessionId) {
      await this.contextState.applySession(session.state, model.editable, this.browserPrintAvailable());
    }
  }

  private async onMessage(session: WyseeEditorSession, message: WebviewToExtensionMessage): Promise<void> {
    this.trace.trace('Webview message', { type: message.type, sessionId: session.sessionId });
    switch (message.type) {
      case 'ready':
        await this.refreshSession(session);
        break;
      case 'focus':
        session.state.focusedBlockId = message.blockId;
        session.state.focusedBlockKind = message.blockKind;
        this.lastActiveSessionId = session.sessionId;
        await this.contextState.applySession(session.state, this.isEditable(session.document.uri), this.browserPrintAvailable());
        break;
      case 'blockClicked': {
        // Always jump to source block on click (webview initiated, suppress source echo)
        this.claimScrollDriver('webview');
        const sourceEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === session.document.uri.toString());
        if (sourceEditor) {
          const startLine = message.startLine;
          const endLine = message.endLine ?? startLine;
          sourceEditor.selection = new vscode.Selection(startLine, 0, endLine, sourceEditor.document.lineAt(Math.min(endLine, sourceEditor.document.lineCount - 1)).text.length);
          sourceEditor.revealRange(new vscode.Range(startLine, 0, startLine, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
        break;
      }
      case 'context':
        session.state.contextBlockId = message.blockId;
        session.state.contextBlockKind = message.blockKind;
        session.state.contextWord = message.word;
        session.state.hasSelection = Boolean(message.hasSelection);
        session.state.selectionText = message.selectionText;
        session.state.lastContextMenuAt = Date.now();
        (session.state as any).insertAfterBlockId = message.insertAfterBlockId;
        this.lastActiveSessionId = session.sessionId;
        await this.contextState.applySession(session.state, this.isEditable(session.document.uri), this.browserPrintAvailable());
        await this.contextState.setCanInsertBlock(message.canInsertBlock !== false);
        break;
      case 'selection':
        session.state.hasSelection = message.hasSelection;
        session.state.selectionText = message.selectionText;
        await this.contextState.applySession(session.state, this.isEditable(session.document.uri), this.browserPrintAvailable());
        break;
      case 'editBlock':
        try {
          await this.blockEditService.applyBlockEdit(session.document, message.payload);
        } catch (error) {
          this.trace.error(error instanceof Error ? error : String(error));
          session.panel.webview.postMessage({ type: 'showError', message: error instanceof Error ? error.message : String(error) });
        }
        break;
      case 'editBlockWithFootnotes':
        try {
          await this.handleEditWithFootnotes(session, message);
        } catch (error) {
          this.trace.error(error instanceof Error ? error : String(error));
          session.panel.webview.postMessage({ type: 'showError', message: error instanceof Error ? error.message : String(error) });
        }
        break;
      case 'toggleEditable':
        await this.toggleEditable(session.document.uri);
        break;
      case 'openExternal':
        await vscode.env.openExternal(vscode.Uri.parse(message.href));
        break;
      case 'insertAtBoundary':
        await this.handleInsertAtBoundary(session, message.afterBlockId, message.markdown);
        break;
      case 'scrollSourceLine': {
        // Webview is driving — scroll source to the exact line (float)
        const targetLine = Math.round(Math.max(0, message.line));
        (session.state as any).scrollTopLine = targetLine;
        if (this.syncScrollEnabled && this.scrollDriver !== 'source') {
          this.claimScrollDriver('webview');
          const sourceEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === session.document.uri.toString());
          if (sourceEditor) {
            const clampedLine = Math.min(targetLine, sourceEditor.document.lineCount - 1);
            sourceEditor.revealRange(new vscode.Range(clampedLine, 0, clampedLine, 0), vscode.TextEditorRevealType.AtTop);
          }
        }
        break;
      }
      case 'requestPreview': {
        const processed = preprocessMath(message.markdown);
        // Separate footnote definitions from main content for preview
        const fnRegistry = buildFootnoteRegistryFromText(message.markdown);
        // Strip footnote definition lines from the text before rendering
        const mainText = message.markdown.replace(/^\[\^[^\]]+\]:\s*.*$/gm, '').trim();
        const processedMain = preprocessMath(mainText);
        let html = this.previewMd.render(processedMain);
        // Convert mermaid code blocks
        html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, (_all, body) => {
          const decoded = body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
          return renderMermaidBlock('```mermaid\n' + decoded.trim() + '\n```');
        });
        // Resolve footnote references
        html = resolveFootnoteReferences(html, fnRegistry);
        // Append footnote section if any
        if (fnRegistry.size > 0) {
          html += '\n' + renderFootnotesSection(fnRegistry);
        }
        session.panel.webview.postMessage({ type: 'previewResult', html, requestId: message.requestId });
        break;
      }
      case 'syncScrollChanged':
        this.syncScrollEnabled = message.enabled;
        break;
      case 'editPanelState':
        (session.state as any).editPanelActive = message.active;
        await this.contextState.setEditPanelActive(message.active);
        if (!message.active) {
          // Panel closed: insertion is available everywhere again
          await this.contextState.setCanInsertBlock(true);
        } else if (message.textareaFocused) {
          // Panel open, textarea focused: insertion goes into textarea (available)
          await this.contextState.setCanInsertBlock(true);
        } else {
          // Panel open, textarea NOT focused: block insertion in canvas
          await this.contextState.setCanInsertBlock(false);
        }
        break;
      case 'undo':
        await vscode.commands.executeCommand('undo');
        break;
      case 'redo':
        await vscode.commands.executeCommand('redo');
        break;
    }
  }

  private async handleInsertAtBoundary(session: WyseeEditorSession, afterBlockId: string | null, markdown: string): Promise<void> {
    const document = session.document;
    const text = markdown.trim();
    if (!text) return;
    const edit = new vscode.WorkspaceEdit();
    if (!afterBlockId) {
      // Insert before the first block (top of document, after frontmatter if any)
      const blocks = buildBlockMap(document);
      const insertOffset = blocks.length > 0 ? blocks[0].startOffset : 0;
      edit.insert(document.uri, document.positionAt(insertOffset), `${text}\n\n`);
    } else {
      const blocks = buildBlockMap(document);
      const block = blocks.find(b => b.blockId === afterBlockId);
      if (!block) return;
      const insertOffset = block.endOffset;
      const docText = document.getText();
      // Ensure proper separation
      const before = docText[insertOffset - 1];
      const prefix = before === '\n' ? '\n' : '\n\n';
      edit.insert(document.uri, document.positionAt(insertOffset), `${prefix}${text}\n`);
    }
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }

  private async handleEditWithFootnotes(
    session: WyseeEditorSession,
    message: { blockId: string; documentVersion: number; mainContent: string; footnoteDefs: { label: string; blockId: string | null; raw: string }[] },
  ): Promise<void> {
    const document = session.document;
    const wsEdit = new vscode.WorkspaceEdit();
    const blocks = buildBlockMap(document);

    // 1. Update the main block with mainContent (raw replacement)
    const mainBlock = blocks.find(b => b.blockId === message.blockId);
    if (mainBlock) {
      const start = document.positionAt(mainBlock.startOffset);
      const end = document.positionAt(mainBlock.endOffset);
      const trailingChar = document.getText()[mainBlock.endOffset - 1];
      const trailing = (trailingChar === '\n' || trailingChar === '\r') ? '\n' : '';
      wsEdit.replace(document.uri, new vscode.Range(start, end), message.mainContent + trailing);
    }

    // 2. Update each footnote definition block
    for (const fnDef of message.footnoteDefs) {
      if (fnDef.blockId) {
        // Update existing footnote def block
        const fnBlock = blocks.find(b => b.blockId === fnDef.blockId);
        if (fnBlock) {
          const start = document.positionAt(fnBlock.startOffset);
          const end = document.positionAt(fnBlock.endOffset);
          const trailingChar = document.getText()[fnBlock.endOffset - 1];
          const trailing = (trailingChar === '\n' || trailingChar === '\r') ? '\n' : '';
          wsEdit.replace(document.uri, new vscode.Range(start, end), fnDef.raw + trailing);
        }
      } else {
        // New footnote definition — append at end of document
        const docText = document.getText();
        const endPos = document.positionAt(docText.length);
        const prefix = docText.endsWith('\n\n') ? '' : docText.endsWith('\n') ? '\n' : '\n\n';
        wsEdit.insert(document.uri, endPos, `${prefix}${fnDef.raw}\n`);
      }
    }

    await vscode.workspace.applyEdit(wsEdit);
    await document.save();
  }

  private findSessionForUri(uri: vscode.Uri): WyseeEditorSession | undefined {
    const ids = this.sessionsByDocument.get(uri.toString());
    if (!ids) return undefined;
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (s) return s;
    }
    return undefined;
  }

  private getHtml(webview: vscode.Webview, sessionId: string): string {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'wysee-editor.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'wysee-editor.js'));
    const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'));
    const katexCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'katex', 'dist', 'katex.min.css'));
    const katexJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'katex', 'dist', 'katex.min.js'));
    let hljsCssUri = '';
    try {
      hljsCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', 'highlight.js', 'styles', 'github-dark.min.css')).toString();
    } catch { /* highlight.js optional */ }
    const syncDefault = this.syncScrollEnabled;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: file: https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource};" />
<link rel="stylesheet" href="${styleUri}" />
<link rel="stylesheet" href="${katexCssUri}" />
${hljsCssUri ? `<link rel="stylesheet" href="${hljsCssUri}" />` : ''}
</head>
<body data-session-id="${escapeHtml(sessionId)}">
<div id="wysee-sync-bar" class="wysee-sync-bar">
  <label><input type="checkbox" id="wysee-sync-scroll" ${syncDefault ? 'checked' : ''} /> Sync scroll</label>
</div>
<div id="wysee-root" class="wysee-root"></div>
<div id="wysee-overlay-host"></div>
<script nonce="${nonce}">window.__WYSEE_SESSION_ID__ = ${JSON.stringify(sessionId)}; window.__WYSEE_MERMAID_URI__ = ${JSON.stringify(mermaidUri.toString())}; window.__WYSEE_KATEX_URI__ = ${JSON.stringify(katexJsUri.toString())}; window.__WYSEE_SYNC_DEFAULT__ = ${syncDefault};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private isEditable(uri: vscode.Uri): boolean {
    return vscode.workspace.getConfiguration('wyseeMd', uri).get<boolean>('preview.editable', true);
  }

  private browserPrintAvailable(): boolean {
    return vscode.workspace.isTrusted;
  }
}
