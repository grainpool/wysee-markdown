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

import * as fs from 'fs/promises';
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
import { PreviewSessionState, RenderViewModel } from '../types';
import { WyseeEditorSession } from './wyseeEditorSession';
import { WebviewToExtensionMessage } from './webviewProtocol';
import { SpellService } from '../spell/spellService';
import { buildBlockMap } from '../render/blockMap';
import { buildDocumentStats, clampHeadingDepth } from '../analysis/markdownStats';
import { debounce } from '../util/debounce';
import { escapeHtml } from '../util/strings';
import { buildAllAddedPresentation, buildConflictPresentation, buildSideBySideDiffPresentations, buildWorkingTreeDiffPresentation } from '../diff/blockDiff';
import { DiffTabContext, GitApiLike, GitRepositoryLike, getBackingFileUri, getGitApi, getResourceIdentityKey, isGitUriLike, resolveDiffTabContext, resolveGitWorkingTreeComparison, uriEquals } from '../diff/gitDiffContext';

export class WyseeEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private readonly sessions = new Map<string, WyseeEditorSession>();
  private readonly sessionsByDocument = new Map<string, Set<string>>();
  private readonly disposables: vscode.Disposable[] = [];
  private lastActiveSessionId?: string;
  private readonly debouncedRefresh = debounce((uri: string) => void this.refreshUri(vscode.Uri.parse(uri)), 120);
  private readonly debouncedDiffContextReconcile = debounce(() => void this.reconcileDiffContexts(), 60);
  private syncScrollEnabled = true;
  private scrollDriver: 'none' | 'source' | 'webview' = 'none';
  private scrollDriverTimer?: ReturnType<typeof setTimeout>;
  private gitApi?: GitApiLike;
  private readonly wiredGitRepositories = new WeakSet<object>();
  private pendingDiffScrollLine?: number;

  private claimScrollDriver(who: 'source' | 'webview') {
    this.scrollDriver = who;
    clearTimeout(this.scrollDriverTimer);
    this.scrollDriverTimer = setTimeout(() => { this.scrollDriver = 'none'; }, 100);
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
    void this.initializeGitIntegration();
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId !== 'markdown') { return; }
        this.debouncedRefresh(event.document.uri.toString());
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        this.debouncedDiffContextReconcile();
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.debouncedDiffContextReconcile();
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

  private async initializeGitIntegration(): Promise<void> {
    this.gitApi = await getGitApi();
    if (!this.gitApi) {
      return;
    }

    for (const repository of this.gitApi.repositories ?? []) {
      this.wireGitRepository(repository);
    }

    if (this.gitApi.onDidOpenRepository) {
      this.disposables.push(this.gitApi.onDidOpenRepository((repository) => {
        this.wireGitRepository(repository);
        void this.refreshAll();
      }));
    }

    if (this.gitApi.onDidCloseRepository) {
      this.disposables.push(this.gitApi.onDidCloseRepository(() => {
        void this.refreshAll();
      }));
    }

    void this.refreshAll();
  }

  private wireGitRepository(repository: GitRepositoryLike): void {
    const key = repository as unknown as object;
    if (this.wiredGitRepositories.has(key)) {
      return;
    }
    this.wiredGitRepositories.add(key);
    this.disposables.push(repository.state.onDidChange(() => {
      void this.refreshAll();
    }));
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
    const createdAt = Date.now();
    const sessionId = `${createdAt}-${Math.random().toString(16).slice(2)}`;
    const state: PreviewSessionState = {
      sessionId, uri: document.uri.toString(), documentVersion: document.version, hasSelection: false,
    };
    const session: WyseeEditorSession = { sessionId, createdAt, document, panel, state };
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

    this.applyResolvedSessionDiffContexts(this.resolveAllSessionDiffContexts());
    this.debouncedDiffContextReconcile();

    panel.onDidDispose(() => {
      this.sessions.delete(sessionId);
      bucket.delete(sessionId);
      if (this.lastActiveSessionId === sessionId) {
        this.lastActiveSessionId = [...this.sessions.keys()].pop();
      }
      void this.reconcileDiffContexts();
      void this.contextState.applySession(this.getActiveSession()?.state, this.isSessionEditable(this.getActiveSession()), this.browserPrintAvailable());
    }, null, this.context.subscriptions);

    panel.onDidChangeViewState(() => {
      if (panel.active) {
        this.lastActiveSessionId = sessionId;
        const changedIds = this.applyResolvedSessionDiffContexts(this.resolveAllSessionDiffContexts());
        if (changedIds.length) {
          for (const changedId of changedIds) {
            const changedSession = this.sessions.get(changedId);
            if (changedSession) {
              void this.refreshSession(changedSession);
            }
          }
        }
        void this.contextState.applySession(session.state, this.isSessionEditable(session), this.browserPrintAvailable());
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

  private resolveAllSessionDiffContexts(): Map<string, DiffTabContext | undefined> {
    const contexts = new Map<string, DiffTabContext | undefined>();
    const unresolvedSessions: WyseeEditorSession[] = [];

    for (const session of this.sessions.values()) {
      const explicitContext = resolveDiffTabContext(session.document.uri, session.panel.viewColumn);
      if (explicitContext) {
        contexts.set(session.sessionId, explicitContext);
      } else {
        unresolvedSessions.push(session);
      }
    }

    const unresolvedGitSessions = unresolvedSessions.filter(session => isGitUriLike(session.document.uri));
    const unresolvedFileSessions = unresolvedSessions.filter(session => session.document.uri.scheme === 'file');
    const pairCandidates: Array<{ gitSession: WyseeEditorSession; fileSession: WyseeEditorSession; score: number }> = [];

    for (const gitSession of unresolvedGitSessions) {
      const gitKey = getResourceIdentityKey(gitSession.document.uri);
      if (!gitKey) {
        continue;
      }
      for (const fileSession of unresolvedFileSessions) {
        const fileKey = getResourceIdentityKey(fileSession.document.uri);
        if (!fileKey || fileKey !== gitKey) {
          continue;
        }
        pairCandidates.push({ gitSession, fileSession, score: this.scoreGitFileSessionPair(gitSession, fileSession) });
      }
    }

    pairCandidates.sort((left, right) => right.score - left.score
      || right.fileSession.createdAt - left.fileSession.createdAt
      || right.gitSession.createdAt - left.gitSession.createdAt);

    const matchedGitSessions = new Set<string>();
    const matchedFileSessions = new Set<string>();

    for (const candidate of pairCandidates) {
      if (matchedGitSessions.has(candidate.gitSession.sessionId) || matchedFileSessions.has(candidate.fileSession.sessionId)) {
        continue;
      }

      matchedGitSessions.add(candidate.gitSession.sessionId);
      matchedFileSessions.add(candidate.fileSession.sessionId);
      contexts.set(candidate.gitSession.sessionId, {
        side: 'original',
        counterpartUri: candidate.fileSession.document.uri,
        groupViewColumn: candidate.fileSession.panel.viewColumn,
      });
      contexts.set(candidate.fileSession.sessionId, {
        side: 'modified',
        counterpartUri: candidate.gitSession.document.uri,
        groupViewColumn: candidate.gitSession.panel.viewColumn,
      });
    }

    for (const gitSession of unresolvedGitSessions) {
      if (matchedGitSessions.has(gitSession.sessionId)) {
        continue;
      }
      const fallbackCounterpart = getBackingFileUri(gitSession.document.uri);
      if (fallbackCounterpart) {
        contexts.set(gitSession.sessionId, {
          side: 'original',
          counterpartUri: fallbackCounterpart,
          groupViewColumn: gitSession.panel.viewColumn,
        });
      }
    }

    // File-file pairing fallback: detect ad hoc diffs opened via codium --diff
    // Two file-scheme sessions opened nearly simultaneously in adjacent columns
    // with different URIs are likely an ad hoc diff pair.
    const stillUnresolved = unresolvedFileSessions.filter(s => !matchedFileSessions.has(s.sessionId) && !contexts.has(s.sessionId));
    if (stillUnresolved.length === 2) {
      const [a, b] = stillUnresolved;
      const timeDelta = Math.abs(a.createdAt - b.createdAt);
      const bothVisible = a.panel.visible && b.panel.visible;
      const differentColumns = a.panel.viewColumn !== b.panel.viewColumn;
      const differentFiles = a.document.uri.toString() !== b.document.uri.toString();

      // Heuristic: opened within 2 seconds, both visible, different columns, different files
      if (timeDelta < 2000 && bothVisible && differentColumns && differentFiles) {
        // Left column = original, right column = modified
        const leftSession = (a.panel.viewColumn ?? 0) <= (b.panel.viewColumn ?? 0) ? a : b;
        const rightSession = leftSession === a ? b : a;
        contexts.set(leftSession.sessionId, {
          side: 'original',
          counterpartUri: rightSession.document.uri,
          groupViewColumn: rightSession.panel.viewColumn,
        });
        contexts.set(rightSession.sessionId, {
          side: 'modified',
          counterpartUri: leftSession.document.uri,
          groupViewColumn: leftSession.panel.viewColumn,
        });
      }
    }

    return contexts;
  }

  private scoreGitFileSessionPair(gitSession: WyseeEditorSession, fileSession: WyseeEditorSession): number {
    let score = 0;

    const gitBackingFile = getBackingFileUri(gitSession.document.uri);
    if (uriEquals(gitBackingFile, fileSession.document.uri)) {
      score += 300;
    }
    if (gitSession.panel.viewColumn === fileSession.panel.viewColumn) {
      score += 120;
    }
    if (gitSession.panel.visible && fileSession.panel.visible) {
      score += 220;
    }
    if (gitSession.panel.active) {
      score += 30;
    }
    if (fileSession.panel.active) {
      score += 30;
    }

    const createdDelta = Math.abs(gitSession.createdAt - fileSession.createdAt);
    score += Math.max(0, 100 - Math.min(100, Math.floor(createdDelta / 100)));
    return score;
  }

  private applyResolvedSessionDiffContexts(contexts: Map<string, DiffTabContext | undefined>): string[] {
    const changedSessionIds: string[] = [];

    for (const session of this.sessions.values()) {
      const next = contexts.get(session.sessionId);
      if (!this.sameDiffContext(session.diffContext, next)) {
        this.trace.trace('Session diff context changed', {
          sessionId: session.sessionId,
          uri: session.document.uri.toString(),
          previousSide: session.diffContext?.side,
          nextSide: next?.side,
          counterpart: next?.counterpartUri.toString(),
        });
        session.diffContext = next;
        changedSessionIds.push(session.sessionId);
      }
    }

    return changedSessionIds;
  }

  private async reconcileDiffContexts(): Promise<void> {
    const changedSessionIds = this.applyResolvedSessionDiffContexts(this.resolveAllSessionDiffContexts());
    if (!changedSessionIds.length) {
      return;
    }

    const refreshes = changedSessionIds
      .map(sessionId => this.sessions.get(sessionId))
      .filter((session): session is WyseeEditorSession => Boolean(session))
      .map(session => this.refreshSession(session));

    await Promise.allSettled(refreshes);
  }

  private sameDiffContext(left: DiffTabContext | undefined, right: DiffTabContext | undefined): boolean {
    return left?.side === right?.side && uriEquals(left?.counterpartUri, right?.counterpartUri);
  }

  private sanitizeDiffLayoutMeasurements(measurements: { groupId: string; height: number }[]): Record<string, number> {
    const next: Record<string, number> = {};
    for (const entry of measurements ?? []) {
      if (!entry || typeof entry.groupId !== 'string' || !entry.groupId) {
        continue;
      }
      const height = Math.round(Number(entry.height));
      if (Number.isFinite(height) && height > 0) {
        next[entry.groupId] = height;
      }
    }
    return next;
  }

  private sanitizeViewportRatio(ratio: number | undefined): number | undefined {
    const value = Number(ratio);
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return Math.max(0, Math.min(1, value));
  }

  private broadcastSyncScrollSetting(): void {
    for (const session of this.sessions.values()) {
      session.panel.webview.postMessage({ type: 'setSyncScroll', enabled: this.syncScrollEnabled });
    }
  }

  private syncViewportFromCounterpart(session: WyseeEditorSession): void {
    if (!this.syncScrollEnabled || !session.diffContext) {
      return;
    }
    const counterpart = this.findDiffCounterpartSession(session);
    const ratio = this.sanitizeViewportRatio(counterpart?.diffViewportRatio);
    if (!counterpart || typeof ratio !== 'number') {
      return;
    }
    session.panel.webview.postMessage({ type: 'syncViewport', ratio });
  }

  private pushViewportSyncFromSession(session: WyseeEditorSession): void {
    if (!this.syncScrollEnabled || !session.diffContext) {
      return;
    }
    const counterpart = this.findDiffCounterpartSession(session);
    const ratio = this.sanitizeViewportRatio(session.diffViewportRatio);
    if (!counterpart || typeof ratio !== 'number') {
      return;
    }
    counterpart.panel.webview.postMessage({ type: 'syncViewport', ratio });
  }

  private findDiffCounterpartSession(session: WyseeEditorSession): WyseeEditorSession | undefined {
    if (!session.diffContext) {
      return undefined;
    }
    for (const candidate of this.sessions.values()) {
      if (candidate.sessionId === session.sessionId || !candidate.diffContext) {
        continue;
      }
      if (candidate.diffContext.side === session.diffContext.side) {
        continue;
      }
      if (uriEquals(candidate.document.uri, session.diffContext.counterpartUri)
        && uriEquals(candidate.diffContext.counterpartUri, session.document.uri)) {
        return candidate;
      }
    }
    return undefined;
  }

  private pushDiffLayoutToSession(session: WyseeEditorSession, source?: WyseeEditorSession): void {
    if (!session.diffContext) {
      return;
    }
    const counterpart = source ?? this.findDiffCounterpartSession(session);
    const measurements = counterpart?.diffLayoutMeasurements
      ? Object.entries(counterpart.diffLayoutMeasurements).map(([groupId, height]) => ({ groupId, height }))
      : [];
    session.panel.webview.postMessage({ type: 'applyDiffLayout', measurements });
  }

  private pushDiffLayoutBetweenSessions(session: WyseeEditorSession): void {
    const counterpart = this.findDiffCounterpartSession(session);
    if (!counterpart) {
      return;
    }
    this.pushDiffLayoutToSession(session, counterpart);
    this.pushDiffLayoutToSession(counterpart, session);
  }

  private isSessionEditable(session?: Pick<WyseeEditorSession, 'document' | 'diffContext'>): boolean {
    return Boolean(session && session.document.uri.scheme === 'file' && !session.diffContext && this.isEditable(session.document.uri));
  }

  private async decorateModelWithDiff(session: WyseeEditorSession, model: RenderViewModel): Promise<void> {
    model.editable = this.isSessionEditable(session);

    if (session.diffContext) {
      try {
        const counterpartDocument = await vscode.workspace.openTextDocument(session.diffContext.counterpartUri);
        const counterpartModel = await this.renderer.renderDocumentToViewModel(counterpartDocument, {
          mode: 'webview', trusted: vscode.workspace.isTrusted, webview: session.panel.webview,
        });
        const presentations = session.diffContext.side === 'original'
          ? buildSideBySideDiffPresentations(model, counterpartModel, 'Open Changes')
          : buildSideBySideDiffPresentations(counterpartModel, model, 'Open Changes');
        model.diff = session.diffContext.side === 'original' ? presentations.original : presentations.modified;
      } catch (error) {
        this.trace.trace('Unable to hydrate diff counterpart', {
          uri: session.document.uri.toString(),
          counterpart: session.diffContext.counterpartUri.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
        model.diff = undefined;
      }
      // Override scroll target if a gutter click triggered the diff open
      if (model.diff && typeof this.pendingDiffScrollLine === 'number') {
        const targetAnchor = this.findNearestDiffAnchor(model, this.pendingDiffScrollLine);
        if (targetAnchor) {
          (model.diff as any).firstAnchorId = targetAnchor;
        }
        this.pendingDiffScrollLine = undefined;
      }
      model.editable = false;
      return;
    }

    const comparison = await resolveGitWorkingTreeComparison(session.document.uri, this.gitApi);
    if (comparison.mode === 'conflict') {
      model.diff = buildConflictPresentation(comparison.label);
      model.editable = false;
      return;
    }
    if (comparison.mode === 'added') {
      model.diff = buildAllAddedPresentation(model, comparison.label);
      return;
    }
    if (comparison.mode === 'compare' && comparison.baseUri) {
      try {
        const baseDocument = await vscode.workspace.openTextDocument(comparison.baseUri);
        const baseModel = await this.renderer.renderDocumentToViewModel(baseDocument, {
          mode: 'webview', trusted: vscode.workspace.isTrusted, webview: session.panel.webview,
        });
        model.diff = buildWorkingTreeDiffPresentation(baseModel, model, comparison.label);
      } catch (error) {
        this.trace.trace('Unable to hydrate Git base', {
          uri: session.document.uri.toString(),
          base: comparison.baseUri.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
        model.diff = undefined;
      }
      return;
    }

    model.diff = undefined;
  }

  /**
   * Find the blockId closest to a target line that has a diff state other than 'unchanged'.
   * Used to scroll the diff view to the clicked gutter indicator.
   */
  private findNearestDiffAnchor(model: RenderViewModel, targetLine: number): string | undefined {
    const diffBlocks = (model.diff as any)?.blocks;
    if (!diffBlocks || !model.blockMap?.length) return undefined;

    let bestId: string | undefined;
    let bestDist = Infinity;

    for (const entry of model.blockMap) {
      const info = diffBlocks[entry.blockId];
      if (!info || info.state === 'unchanged') continue;
      const dist = Math.min(
        Math.abs(entry.startLine - targetLine),
        Math.abs(entry.endLine - targetLine),
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestId = entry.blockId;
      }
    }

    return bestId;
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
    const sectionDepth = clampHeadingDepth(vscode.workspace.getConfiguration('wyseeMd', session.document.uri).get<number>('preview.statsSectionDepth', 1));
    model.stats = await buildDocumentStats(session.document, model.blockMap, sectionDepth);
    await this.decorateModelWithDiff(session, model);
    session.state.documentVersion = session.document.version;
    session.model = model;
    session.panel.webview.postMessage({ type: 'render', model });
    this.pushDiffLayoutToSession(session);
    if (session.diffContext) {
      this.pushDiffLayoutBetweenSessions(session);
      this.syncViewportFromCounterpart(session);
    }
    if (this.lastActiveSessionId === session.sessionId) {
      await this.contextState.applySession(session.state, this.isSessionEditable(session), this.browserPrintAvailable());
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
        await this.contextState.applySession(session.state, this.isSessionEditable(session), this.browserPrintAvailable());
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
        await this.contextState.applySession(session.state, this.isSessionEditable(session), this.browserPrintAvailable());
        await this.contextState.setCanInsertBlock(message.canInsertBlock !== false);
        break;
      case 'selection':
        session.state.hasSelection = message.hasSelection;
        session.state.selectionText = message.selectionText;
        await this.contextState.applySession(session.state, this.isSessionEditable(session), this.browserPrintAvailable());
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
        this.broadcastSyncScrollSetting();
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
      case 'pasteClipboardImages':
        try {
          await this.handlePasteClipboardImages(session, message);
        } catch (error) {
          this.trace.error(error instanceof Error ? error : String(error));
          session.panel.webview.postMessage({ type: 'showError', message: error instanceof Error ? error.message : String(error) });
        }
        break;
      case 'reportDiffLayout':
        session.diffLayoutMeasurements = this.sanitizeDiffLayoutMeasurements(message.measurements);
        this.pushDiffLayoutBetweenSessions(session);
        break;
      case 'reportViewport':
        session.diffViewportRatio = this.sanitizeViewportRatio(message.ratio);
        this.pushViewportSyncFromSession(session);
        break;
      case 'openDiffAtLine':
        this.pendingDiffScrollLine = typeof message.line === 'number' ? message.line : undefined;
        try {
          await vscode.commands.executeCommand('git.openChange', session.document.uri);
        } catch {
          this.pendingDiffScrollLine = undefined;
        }
        break;
      case 'exportAction': {
        const actionMap: Record<string, string> = {
          print: 'wyseeMd.print',
          savePdf: 'wyseeMd.exportPdf',
          style: 'wyseeMd.theme.select',
          source: 'wyseeMd.source.openToSide',
          exportApprovalMatrix: 'wysee.exportApprovalMatrix',
          configureAi: 'wysee.approvalMatrix.ai.settings',
        };
        const cmd = actionMap[message.action];
        if (cmd) {
          await vscode.commands.executeCommand(cmd);
        }
        break;
      }
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

  private async handlePasteClipboardImages(
    session: WyseeEditorSession,
    message: { target: 'editPanel' | 'selectedBlock'; blockId?: string; images: { dataUrl: string; mimeType: string }[] },
  ): Promise<void> {
    const savedFiles = await this.saveClipboardImages(session.document.uri, message.images);
    if (!savedFiles.length) {
      return;
    }
    const markdown = savedFiles.map((name) => `![Clipboard image](${name})`).join('\n\n');
    if (message.target === 'editPanel') {
      session.panel.webview.postMessage({ type: 'insertTemplateIntoTextarea', text: markdown });
      return;
    }

    const anchor = vscode.workspace.getConfiguration('wyseeMd', session.document.uri).get<'before' | 'after'>('preview.insertRelativeToBlock', 'after');
    const afterBlockId = this.resolveAfterBlockIdForAnchor(session.document, message.blockId ?? null, anchor);
    await this.handleInsertAtBoundary(session, afterBlockId, markdown);
  }

  private async saveClipboardImages(
    documentUri: vscode.Uri,
    images: { dataUrl: string; mimeType: string }[],
  ): Promise<string[]> {
    const dir = path.dirname(documentUri.fsPath);
    let nextIndex = await this.findNextClipboardImageIndex(dir);
    const saved: string[] = [];

    for (const image of images) {
      const match = /^data:[^;]+;base64,(.+)$/i.exec(image.dataUrl);
      if (!match) {
        continue;
      }
      const filename = `wysee-clipboard-${nextIndex}.png`;
      const target = path.join(dir, filename);
      await fs.writeFile(target, Buffer.from(match[1], 'base64'));
      saved.push(filename);
      nextIndex += 1;
    }

    return saved;
  }

  private async findNextClipboardImageIndex(dir: string): Promise<number> {
    try {
      const entries = await fs.readdir(dir);
      let max = 0;
      for (const entry of entries) {
        const match = /^wysee-clipboard-(\d+)\.png$/i.exec(entry);
        if (!match) {
          continue;
        }
        max = Math.max(max, Number(match[1]));
      }
      return max + 1;
    } catch {
      return 1;
    }
  }

  private resolveAfterBlockIdForAnchor(
    document: vscode.TextDocument,
    blockId: string | null,
    anchor: 'before' | 'after',
  ): string | null {
    const blocks = buildBlockMap(document).filter((block) => block.kind !== 'footnoteDefinition');
    if (!blocks.length) {
      return null;
    }
    if (!blockId || blockId === 'b:footnotes') {
      return anchor === 'before' ? null : blocks[blocks.length - 1].blockId;
    }
    if (anchor === 'after') {
      return blockId;
    }
    const index = blocks.findIndex((block) => block.blockId === blockId);
    if (index <= 0) {
      return null;
    }
    return blocks[index - 1].blockId;
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
    const shortcutsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'wysee-editor-shortcuts.js'));
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
  <div class="wysee-sync-bar-left">
    <button type="button" id="wysee-export-menu-btn" class="wysee-link-button">Export options\u2026</button>
  </div>
  <div class="wysee-sync-bar-right">
    <span id="wysee-word-count" class="wysee-stat-summary">Word Count: 0</span>
    <button type="button" id="wysee-more-stats" class="wysee-link-button">More Stats</button>
    <label><input type="checkbox" id="wysee-sync-scroll" ${syncDefault ? 'checked' : ''} /> Sync scroll</label>
  </div>
</div>
<div id="wysee-export-overlay" class="wysee-export-popup-overlay">
  <div class="wysee-export-popup">
    <div class="wysee-export-popup-title">Export options</div>
    <button type="button" data-wysee-action="print">Print\u2026</button>
    <button type="button" data-wysee-action="savePdf">Save PDF\u2026</button>
    <hr />
    <button type="button" data-wysee-action="exportApprovalMatrix">Export Approval Matrix\u2026</button>
    <hr />
    <button type="button" data-wysee-action="configureAi">Configure AI\u2026</button>
  </div>
</div>
<div id="wysee-find-bar" class="wysee-find-bar is-hidden" role="search" aria-label="Find in document">
  <div class="wysee-find-input-group">
    <input type="text" id="wysee-find-input" placeholder="Find" aria-label="Find" />
    <button type="button" id="wysee-find-prev" class="wysee-find-nav" aria-label="Previous match">&#x25B2;</button>
    <button type="button" id="wysee-find-next" class="wysee-find-nav" aria-label="Next match">&#x25BC;</button>
  </div>
  <span id="wysee-find-status" class="wysee-find-status"></span>
  <div class="wysee-find-toggles">
    <label class="wysee-find-toggle"><input type="checkbox" id="wysee-find-highlight-all" checked />Highlight All</label>
    <label class="wysee-find-toggle"><input type="checkbox" id="wysee-find-match-case" />Match case</label>
    <label class="wysee-find-toggle"><input type="checkbox" id="wysee-find-match-markdown" />Match Markdown</label>
  </div>
  <button type="button" id="wysee-find-close" aria-label="Close find">×</button>
</div>
<div id="wysee-root" class="wysee-root"></div>
<div id="wysee-overlay-host"></div>
<script nonce="${nonce}">window.__WYSEE_SESSION_ID__ = ${JSON.stringify(sessionId)}; window.__WYSEE_MERMAID_URI__ = ${JSON.stringify(mermaidUri.toString())}; window.__WYSEE_KATEX_URI__ = ${JSON.stringify(katexJsUri.toString())}; window.__WYSEE_SYNC_DEFAULT__ = ${syncDefault};</script>
<script nonce="${nonce}" src="${shortcutsUri}"></script>
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
