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

import * as vscode from 'vscode';
import { CTX, EXT_ID, MARKDOWN_PATTERNS, STORAGE, VIEWTYPE_EDITOR } from './constants';
import { TraceService } from './diagnostics/trace';
import { ThemeService } from './theme/themeService';
import { PageProfileService } from './theme/pageProfileService';
import { SpellService } from './spell/spellService';
import { SpellCodeActionProvider } from './spell/spellCodeActions';
import { MarkdownRenderer } from './render/markdownRenderer';
import { BlockEditService } from './source/blockEditService';
import { InsertTemplateService } from './source/insertTemplateService';
import { ContextStateService } from './editor/contextState';
import { WyseeEditorProvider } from './editor/wyseeEditorProvider';
import { BrowserPrintTransportManager } from './print/browserPrintTransportManager';
import { ExternalPrintServer } from './print/externalPrintServer';
import { PrintBundleService } from './print/printBundleService';
import { ExportHtmlService } from './export/exportHtmlService';
import { ApprovalMatrixOrchestrator } from './export/approvalMatrix/approvalMatrixOrchestrator';
import { registerApprovalMatrixCommand } from './export/approvalMatrix/approvalMatrixCommand';
import { AiSecretStore } from './export/approvalMatrix/ai/aiSecretStore';
import { AiConfigService } from './export/approvalMatrix/ai/aiConfigService';
import { AiSummaryService } from './export/approvalMatrix/ai/aiSummaryService';
import { ContextInspector } from './diagnostics/contextInspector';
import { SelfCheckService } from './diagnostics/selfCheck';
import { StyleManager } from './style/styleManager';
import { StylePanelProvider } from './style/stylePanelProvider';
import { InsertAnchor } from './types';

let trace: TraceService;
let provider: WyseeEditorProvider;
let spellService: SpellService;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  trace = new TraceService();
  context.subscriptions.push(trace.channel);
  setTraceLevel();

  const styleManager = new StyleManager(context, trace);
  const themeService = new ThemeService(context, trace, styleManager);
  const pageProfileService = new PageProfileService(context, trace, styleManager);
  spellService = new SpellService(context, trace);
  await Promise.all([themeService.initialize(), pageProfileService.initialize(), spellService.initialize()]);

  const renderer = new MarkdownRenderer({ trace, themeService, pageProfileService, spellService, styleManager });
  const blockEditService = new BlockEditService(trace);
  const contextState = new ContextStateService();
  const transportManager = new BrowserPrintTransportManager(trace);
  const printServer = new ExternalPrintServer(trace);
  const printBundleService = new PrintBundleService(renderer, themeService, pageProfileService, printServer, transportManager, trace);
  const exportHtmlService = new ExportHtmlService(renderer, trace);
  provider = WyseeEditorProvider.register(context, renderer, blockEditService, contextState, spellService, trace);
  const inspector = new ContextInspector(provider, contextState, themeService, pageProfileService, transportManager);
  const selfCheck = new SelfCheckService(context, provider, themeService, pageProfileService, spellService, printServer, transportManager);
  const insertTemplateService = new InsertTemplateService(trace);
  const stylePanel = new StylePanelProvider(context, styleManager, trace, () => provider.refreshAll());

  // Approval matrix export + AI
  const aiSecretStore = new AiSecretStore(context.secrets);
  const aiConfigService = new AiConfigService(aiSecretStore);
  const aiSummaryService = new AiSummaryService(aiConfigService, trace);
  const approvalMatrixOrchestrator = new ApprovalMatrixOrchestrator(provider, renderer, trace, aiConfigService, aiSummaryService);
  registerApprovalMatrixCommand(context, approvalMatrixOrchestrator);

  // Lazy-load panel to avoid circular dependency
  let aiConfigPanel: any;
  context.subscriptions.push(
    vscode.commands.registerCommand('wysee.approvalMatrix.ai.settings', async () => {
      if (!aiConfigPanel) {
        const { AiConfigPanelProvider } = await import('./export/approvalMatrix/ai/aiConfigPanelProvider');
        aiConfigPanel = new AiConfigPanelProvider(context, aiConfigService, aiSecretStore);
      }
      await aiConfigPanel.open();
    }),
    vscode.commands.registerCommand('wysee.approvalMatrix.ai.setSecret', () => aiSecretStore.setSecretInteractive()),
    vscode.commands.registerCommand('wysee.approvalMatrix.ai.clearSecret', () => aiSecretStore.clearSecretInteractive()),
    vscode.commands.registerCommand('wysee.approvalMatrix.ai.previewPrompt', async () => {
      const { previewPrompt } = await import('./export/approvalMatrix/ai/aiPromptCompiler');
      const config = await aiConfigService.readConfigRaw();
      const compiled = previewPrompt(config);
      const content = `# AI Prompt Preview\n\n## System Message\n\n\`\`\`\n${compiled.systemMessage}\n\`\`\`\n\n## User Message\n\n\`\`\`\n${compiled.userMessage}\n\`\`\`\n`;
      const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider({ language: 'markdown' }, new SpellCodeActionProvider(spellService), {
      providedCodeActionKinds: SpellCodeActionProvider.providedCodeActionKinds,
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => { if (doc.languageId === 'markdown') { void spellService.runSpellcheck(doc); } }),
    vscode.workspace.onDidSaveTextDocument((doc) => { if (doc.languageId === 'markdown') { void spellService.runSpellcheck(doc); } }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('wyseeMd.trace.level')) {
        setTraceLevel();
      }
      if (event.affectsConfiguration('wyseeMd.style') || event.affectsConfiguration('wyseeMd.printProfile') || event.affectsConfiguration('wyseeMd.preview')) {
        void provider.refreshAll();
      }
    }),
  );

  await ensureDefaultEditorAssociations(context);
  await registerCommands(context, {
    themeService,
    pageProfileService,
    printBundleService,
    exportHtmlService,
    contextState,
    inspector,
    selfCheck,
    insertTemplateService,
    stylePanel,
  });

  trace.info('Activated Wysee MD', { id: EXT_ID, viewType: VIEWTYPE_EDITOR });
}

export function deactivate(): void {
  spellService?.diagnostics.clear();
}

interface Services {
  themeService: ThemeService;
  pageProfileService: PageProfileService;
  printBundleService: PrintBundleService;
  exportHtmlService: ExportHtmlService;
  contextState: ContextStateService;
  inspector: ContextInspector;
  selfCheck: SelfCheckService;
  insertTemplateService: InsertTemplateService;
  stylePanel: StylePanelProvider;
}

async function registerCommands(context: vscode.ExtensionContext, services: Services): Promise<void> {
  const add = (command: string, handler: (...args: any[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));
  };

  add('wyseeMd.print', async () => {
    const uri = await resolveActiveMarkdownUri();
    if (!uri) { return; }
    trace.info('Command entry', { command: 'wyseeMd.print', uri: uri.toString() });
    await services.printBundleService.printDocument(uri);
  });

  add('wyseeMd.exportPdf', async () => {
    const uri = await resolveActiveMarkdownUri();
    if (!uri) { return; }
    trace.info('Command entry', { command: 'wyseeMd.exportPdf', uri: uri.toString() });
    await services.printBundleService.exportPdfToFile(uri);
  });

  add('wyseeMd.exportHtml', async () => {
    const uri = await resolveActiveMarkdownUri();
    if (!uri) { return; }
    const target = await vscode.window.showSaveDialog({
      defaultUri: uri.with({ path: uri.path.replace(/\.md(?:own|arkdown|kdn|kd)?$/i, '.html') }),
      filters: { HTML: ['html'] },
      saveLabel: 'Export HTML',
    });
    if (!target) { return; }
    trace.info('Command entry', { command: 'wyseeMd.exportHtml', uri: uri.toString(), target: target.toString() });
    await services.exportHtmlService.exportHtml(uri, undefined, undefined, target);
  });

  // Style panel — replaces old theme/pageProfile quickpicks
  const openStylePanel = async () => { await services.stylePanel.open(); };
  add('wyseeMd.theme.select', openStylePanel);
  add('wyseeMd.theme.saveCurrentAs', openStylePanel);
  add('wyseeMd.theme.manage', openStylePanel);
  add('wyseeMd.pageProfile.select', openStylePanel);
  add('wyseeMd.pageProfile.saveCurrentAs', openStylePanel);
  add('wyseeMd.pageProfile.manage', openStylePanel);

  add('wyseeMd.preview.toggleEditable', async () => {
    const uri = await resolveActiveMarkdownUri();
    const editable = await provider.toggleEditable(uri);
    await vscode.commands.executeCommand('setContext', CTX.editorEditable, editable);
  });

  add('wyseeMd.source.openToSide', async () => {
    const uri = await resolveActiveMarkdownUri();
    if (uri) {
      await provider.openSourceToSide(uri);
    }
  });

  add('wyseeMd.editor.restoreBuiltInDefault', async () => {
    const uri = await resolveActiveMarkdownUri();
    if (!uri) { return; }
    await restoreBuiltInDefault(context);
    await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
  });

  add('wyseeMd.openWithWysee', async (uri?: vscode.Uri) => {
    // Resolve URI: from explorer context menu, tab context menu, or active editor
    let target = uri;
    if (!target) {
      target = await resolveActiveMarkdownUri();
    }
    if (!target) {
      vscode.window.showWarningMessage('No Markdown file selected.');
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', target, 'grainpool.wysee-md.editor');
  });

  add('wyseeMd.insertBlock.openMenu', async () => {
    const picked = await vscode.window.showQuickPick([
      { label: 'Heading 1', id: 'heading1' },
      { label: 'Heading 2', id: 'heading2' },
      { label: 'Heading 3', id: 'heading3' },
      { label: 'Heading 4', id: 'heading4' },
      { label: 'Heading 5', id: 'heading5' },
      { label: 'Heading 6', id: 'heading6' },
      { label: 'Link', id: 'link' },
      { label: 'Image', id: 'image' },
      { label: 'Quote', id: 'quote' },
      { label: 'Footnote', id: 'footnote' },
      { label: 'Code Fence', id: 'codeFence' },
      { label: 'Mermaid Fence', id: 'mermaidFence' },
      { label: 'Task List', id: 'taskList' },
      { label: 'Horizontal Rule', id: 'hr' },
      { label: 'Table 2x2', id: 'table2x2' },
      { label: 'Table with alignment row', id: 'tableAligned' },
      { label: 'Table MxN', id: 'tableCustom' },
    ], { title: 'Insert MD block\u2026' });
    if (picked) {
      await insertTemplateCommand(services.insertTemplateService, picked.id);
    }
  });

  const templateMap: Record<string, string> = {
    'wyseeMd.insertBlock.heading1': 'heading1',
    'wyseeMd.insertBlock.heading2': 'heading2',
    'wyseeMd.insertBlock.heading3': 'heading3',
    'wyseeMd.insertBlock.heading4': 'heading4',
    'wyseeMd.insertBlock.heading5': 'heading5',
    'wyseeMd.insertBlock.heading6': 'heading6',
    'wyseeMd.insertBlock.link': 'link',
    'wyseeMd.insertBlock.image': 'image',
    'wyseeMd.insertBlock.quote': 'quote',
    'wyseeMd.insertBlock.footnote': 'footnote',
    'wyseeMd.insertBlock.codeFence': 'codeFence',
    'wyseeMd.insertBlock.hr': 'hr',
    'wyseeMd.insertBlock.table2x2': 'table2x2',
    'wyseeMd.insertBlock.tableAligned': 'tableAligned',
    'wyseeMd.insertBlock.tableCustom': 'tableCustom',
    'wyseeMd.insertBlock.taskList': 'taskList',
    'wyseeMd.insertBlock.mermaidFence': 'mermaidFence',
  };
  for (const [command, templateId] of Object.entries(templateMap)) {
    add(command, async () => insertTemplateCommand(services.insertTemplateService, templateId));
  }

  add('wyseeMd.spell.addToUserDictionary', async (args?: any) => {
    const { word } = await resolveWordAndUri(args);
    if (!word) { return; }
    await spellService.addWordToUserDictionary(word);
    await rerunSpellOnActiveDocument();
  });

  add('wyseeMd.spell.addToWorkspaceDictionary', async (args?: any) => {
    const { word, uri } = await resolveWordAndUri(args);
    if (!word || !uri) { return; }
    await spellService.addWordToWorkspaceDictionary(word, uri);
    await rerunSpellOnActiveDocument();
  });

  add('wyseeMd.spell.ignoreWordSession', async (args?: any) => {
    const { word } = await resolveWordAndUri(args);
    if (!word) { return; }
    spellService.ignoreWordSession(word);
    await rerunSpellOnActiveDocument();
  });

  add('wyseeMd.spell.ignoreWordDocument', async (args?: any) => {
    const { word, uri } = await resolveWordAndUri(args);
    if (!word || !uri) { return; }
    await addIgnoreWordPragma(uri, word);
    await rerunSpellOnActiveDocument();
  });

  add('wyseeMd.spell.nextIssue', async () => navigateSpellIssue(true));
  add('wyseeMd.spell.previousIssue', async () => navigateSpellIssue(false));

  add('wyseeMd.dev.openLog', () => trace.show());
  add('wyseeMd.dev.inspectContext', async () => openJsonDocument(await services.inspector.inspect(), 'json'));
  add('wyseeMd.dev.runSelfCheck', async () => openJsonDocument(await services.selfCheck.runSelfCheck(), 'json'));
}

function setTraceLevel(): void {
  const level = vscode.workspace.getConfiguration('wyseeMd').get<any>('trace.level', 'info');
  trace.setLevel(level);
}

async function ensureDefaultEditorAssociations(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('wyseeMd');
  if (!config.get<boolean>('editor.defaultForMarkdown', true) || !config.get<boolean>('editor.writeUserAssociationOnFirstRun', true)) {
    return;
  }
  const workbench = vscode.workspace.getConfiguration('workbench');
  const raw = workbench.get<any>('editorAssociations', []) ?? [];
  const existing: any[] = Array.isArray(raw) ? [...raw] : Object.entries(raw).map(([filenamePattern, viewType]) => ({ filenamePattern, viewType }));
  const added: string[] = [];
  for (const pattern of MARKDOWN_PATTERNS) {
    const entry = existing.find((item) => item.filenamePattern === pattern);
    if (!entry) {
      existing.push({ viewType: VIEWTYPE_EDITOR, filenamePattern: pattern });
      added.push(pattern);
    }
  }
  if (added.length) {
    await workbench.update('editorAssociations', existing, vscode.ConfigurationTarget.Global);
    await context.globalState.update(STORAGE.defaultAssociationApplied, true);
    await context.globalState.update(STORAGE.associationPatternsAdded, added);
  }
}

async function restoreBuiltInDefault(context: vscode.ExtensionContext): Promise<void> {
  const workbench = vscode.workspace.getConfiguration('workbench');
  const raw = workbench.get<any>('editorAssociations', []) ?? [];
  const existing: any[] = Array.isArray(raw) ? [...raw] : Object.entries(raw).map(([filenamePattern, viewType]) => ({ filenamePattern, viewType }));
  const added = context.globalState.get<string[]>(STORAGE.associationPatternsAdded, []);
  const filtered = existing.filter((item) => !(item.viewType === VIEWTYPE_EDITOR && added.includes(item.filenamePattern)));
  await workbench.update('editorAssociations', filtered, vscode.ConfigurationTarget.Global);
  await context.globalState.update(STORAGE.associationPatternsAdded, []);
}

async function insertTemplateCommand(service: InsertTemplateService, templateId: string): Promise<void> {
  // Case 1: Source text editor is active — insert at cursor
  const sourceEditor = vscode.window.activeTextEditor;
  if (sourceEditor && sourceEditor.document.languageId === 'markdown') {
    const target = { uri: sourceEditor.document.uri, selection: sourceEditor.selection };
    const dims = templateId === 'tableCustom' ? await promptTableDimensions() : undefined;
    await service.insertTemplate(target, templateId, 'after', dims);
    return;
  }
  // Case 2: WYSIWYG session active
  const session = provider.getActiveSession();
  if (!session) {
    return;
  }
  // Case 2a: Edit/insert panel textarea is active — send template text to webview for insertion into textarea
  if ((session.state as any).editPanelActive) {
    const dims = templateId === 'tableCustom' ? await promptTableDimensions() : undefined;
    const templateText = getTemplateText(templateId, dims);
    session.panel.webview.postMessage({ type: 'insertTemplateIntoTextarea', text: templateText });
    return;
  }
  // Case 2b: Normal canvas — insert as block
  // Use the insertAfterBlockId from the context message if available (set by right-click location)
  const insertAfterBlockId = (session.state as any).insertAfterBlockId;
  const blockId = insertAfterBlockId !== undefined ? insertAfterBlockId : (session.state.contextBlockId ?? session.state.focusedBlockId);
  const anchor = insertAfterBlockId !== undefined ? 'after' as InsertAnchor : vscode.workspace.getConfiguration('wyseeMd', session.document.uri).get<InsertAnchor>('preview.insertRelativeToBlock', 'after');
  const dims = templateId === 'tableCustom' ? await promptTableDimensions() : undefined;
  await service.insertTemplate({ uri: session.document.uri, blockId: blockId ?? undefined }, templateId, anchor, dims);
}

function getTemplateText(templateId: string, dims?: { cols: number; rows: number }): string {
  const templates: Record<string, string> = {
    heading1: '# Heading\n', heading2: '## Heading\n', heading3: '### Heading\n',
    heading4: '#### Heading\n', heading5: '##### Heading\n', heading6: '###### Heading\n',
    link: '[Link text](https://example.com)\n', image: '![Alt](./image.png){width=100%, align=center}\n',
    quote: '> Quote\n', footnote: 'Text with footnote.[^1]\n\n[^1]: Footnote text.\n',
    codeFence: '```text\ncode\n```\n', hr: '---\n',
    taskList: '- [ ] Task\n- [ ] Task\n',
    mermaidFence: '```mermaid\nflowchart TD\n  A[Start] --> B[Finish]\n```\n',
  };
  if (templateId === 'table2x2') return buildTemplateTable(2, 2, false);
  if (templateId === 'tableAligned') return buildTemplateTable(3, 3, true);
  if (templateId === 'tableCustom') return buildTemplateTable(dims?.cols ?? 3, dims?.rows ?? 3, false);
  return templates[templateId] ?? `${templateId}\n`;
}

function buildTemplateTable(cols: number, rows: number, aligned: boolean): string {
  const headers = Array.from({ length: cols }, (_, i) => ` Col ${i + 1} `);
  const align = Array.from({ length: cols }, (_, i) => (aligned && i === 0 ? ' :--- ' : ' --- '));
  const body = Array.from({ length: Math.max(rows - 1, 1) }, (_, row) => `|${Array.from({ length: cols }, (_, col) => ` R${row + 1}C${col + 1} `).join('|')}|`);
  return [`|${headers.join('|')}|`, `|${align.join('|')}|`, ...body].join('\n') + '\n';
}

async function promptTableDimensions(): Promise<{ cols: number; rows: number } | undefined> {
  const colStr = await vscode.window.showInputBox({ prompt: 'Number of table columns (1-16)', value: '3', validateInput: (v) => { const n = Number(v); return (Number.isInteger(n) && n >= 1 && n <= 16) ? undefined : 'Enter 1-16'; } });
  if (!colStr) { return undefined; }
  const cols = Number(colStr);
  const rowStr = await vscode.window.showInputBox({ prompt: 'Number of table rows (1-32)', value: '3', validateInput: (v) => { const n = Number(v); return (Number.isInteger(n) && n >= 1 && n <= 32) ? undefined : 'Enter 1-32'; } });
  if (!rowStr) { return undefined; }
  const rows = Number(rowStr);
  return { cols, rows };
}

async function resolveActiveMarkdownUri(): Promise<vscode.Uri | undefined> {
  const sourceEditor = vscode.window.activeTextEditor;
  if (sourceEditor?.document.languageId === 'markdown') {
    return sourceEditor.document.uri;
  }
  const session = provider.getActiveSession();
  return session?.document.uri;
}

async function resolveWordAndUri(args?: any): Promise<{ word?: string; uri?: vscode.Uri }> {
  const session = provider.getActiveSession();
  const sourceEditor = vscode.window.activeTextEditor;
  const uriString = args?.uri ?? session?.document.uri.toString() ?? sourceEditor?.document.uri.toString();
  const uri = uriString ? vscode.Uri.parse(uriString) : undefined;
  const word = args?.word ?? session?.state.contextWord ?? selectedWord(sourceEditor);
  return { word, uri };
}

function selectedWord(editor?: vscode.TextEditor): string | undefined {
  if (!editor) {
    return undefined;
  }
  const selected = editor.document.getText(editor.selection).trim();
  if (selected) {
    return selected;
  }
  const range = editor.document.getWordRangeAtPosition(editor.selection.active);
  return range ? editor.document.getText(range) : undefined;
}

async function rerunSpellOnActiveDocument(): Promise<void> {
  const uri = await resolveActiveMarkdownUri();
  if (!uri) { return; }
  const doc = await vscode.workspace.openTextDocument(uri);
  await spellService.runSpellcheck(doc);
  await provider.refreshUri(uri);
}

async function navigateSpellIssue(forward: boolean): Promise<void> {
  const uri = await resolveActiveMarkdownUri();
  if (!uri) { return; }
  const doc = await vscode.workspace.openTextDocument(uri);
  const diagnostics = spellService.diagnostics.get(uri) ?? [];
  if (!diagnostics.length) {
    return;
  }
  let editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.toString() !== uri.toString()) {
    editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside, false);
  }
  const currentOffset = doc.offsetAt(editor.selection.active);
  const sorted = [...diagnostics].sort((a, b) => doc.offsetAt(a.range.start) - doc.offsetAt(b.range.start));
  const next = forward
    ? sorted.find((item) => doc.offsetAt(item.range.start) > currentOffset) ?? sorted[0]
    : [...sorted].reverse().find((item) => doc.offsetAt(item.range.start) < currentOffset) ?? sorted[sorted.length - 1];
  editor.selection = new vscode.Selection(next.range.start, next.range.end);
  editor.revealRange(next.range, vscode.TextEditorRevealType.InCenter);
}

async function chooseWorkspaceOrGlobal(uri?: vscode.Uri): Promise<boolean | undefined> {
  const options: vscode.QuickPickItem[] = [{ label: 'Global' }];
  if (uri && vscode.workspace.getWorkspaceFolder(uri) && vscode.workspace.isTrusted) {
    options.unshift({ label: 'Workspace' });
  }
  const picked = await vscode.window.showQuickPick(options, { title: 'Save location' });
  if (!picked) { return undefined; }
  return picked.label === 'Workspace';
}

async function addIgnoreWordPragma(uri: vscode.Uri, word: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const text = document.getText();
  const pragma = /<!--\s*wysee:ignore-words\s+([^>]*)-->/i;
  const edit = new vscode.WorkspaceEdit();
  if (pragma.test(text)) {
    const match = pragma.exec(text)!;
    const merged = new Set(match[1].split(',').map((part) => part.trim()).filter(Boolean));
    merged.add(word);
    const replacement = `<!-- wysee:ignore-words ${[...merged].join(', ')} -->`;
    edit.replace(uri, new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length)), replacement);
  } else {
    edit.insert(uri, new vscode.Position(0, 0), `<!-- wysee:ignore-words ${word} -->\n\n`);
  }
  await vscode.workspace.applyEdit(edit);
  await document.save();
}

async function openJsonDocument(value: unknown, language = 'json'): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content: `${JSON.stringify(value, null, 2)}\n`, language });
  await vscode.window.showTextDocument(doc, { preview: false });
}
