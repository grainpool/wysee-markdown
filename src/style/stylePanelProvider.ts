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
import { StyleManager } from './styleManager';
import { TraceService } from '../diagnostics/trace';
import { starterStyleJson, starterPrintJson, starterSyntaxJson, ELEMENT_KEY_DOCS, SYNTAX_TOKEN_DOCS } from './styleDefaults';
import { escapeHtml } from '../util/strings';

interface PanelState {
  styles: { id: string; name: string; builtIn?: boolean }[];
  printProfiles: { id: string; name: string; builtIn?: boolean }[];
  syntaxStyles: { id: string; name: string; builtIn?: boolean }[];
  activeStyleId: string;
  activePrintId: string;
  activeSyntaxId: string;
}

type PanelMessage =
  | { type: 'ready' }
  | { type: 'selectStyle'; id: string }
  | { type: 'selectPrint'; id: string }
  | { type: 'selectSyntax'; id: string }
  | { type: 'editStyle'; id: string }
  | { type: 'editPrint'; id: string }
  | { type: 'editSyntax'; id: string }
  | { type: 'addStyle' }
  | { type: 'addPrint' }
  | { type: 'addSyntax' }
  | { type: 'saveStyle'; json: string }
  | { type: 'savePrint'; json: string }
  | { type: 'saveSyntax'; json: string }
  | { type: 'cancelEdit' }
  | { type: 'validateStyle'; json: string }
  | { type: 'validatePrint'; json: string }
  | { type: 'validateSyntax'; json: string }
  | { type: 'deleteStyle'; id: string }
  | { type: 'deletePrint'; id: string }
  | { type: 'deleteSyntax'; id: string };

export class StylePanelProvider {
  private panel?: vscode.WebviewPanel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly styleManager: StyleManager,
    private readonly trace: TraceService,
    private readonly onChanged: () => Promise<void>,
  ) {}

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      await this.refresh();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'wysee-md-style-panel', 'Style',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage((msg: PanelMessage) => this.onMessage(msg));
    this.panel.webview.html = this.getHtml();
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (!this.panel) return;
    const styles = await this.styleManager.listStyles();
    const printProfiles = await this.styleManager.listPrintProfiles();
    const syntaxStyles = await this.styleManager.listSyntaxStyles();
    const activeStyle = await this.styleManager.getActiveStyle();
    const activePrint = await this.styleManager.getActivePrintProfile();
    const activeSyntax = await this.styleManager.getActiveSyntaxStyle();
    const state: PanelState = {
      styles: styles.map((s) => ({ id: s.id, name: s.name, builtIn: s.builtIn })),
      printProfiles: printProfiles.map((p) => ({ id: p.id, name: p.name, builtIn: p.builtIn })),
      syntaxStyles: syntaxStyles.map((s) => ({ id: s.id, name: s.name, builtIn: s.builtIn })),
      activeStyleId: activeStyle.id,
      activePrintId: activePrint.id,
      activeSyntaxId: activeSyntax.id,
    };
    this.panel.webview.postMessage({ type: 'state', state });
  }

  private async onMessage(msg: PanelMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.refresh();
        break;
      case 'selectStyle':
        await this.styleManager.setActiveStyle(msg.id);
        await this.onChanged();
        await this.refresh();
        break;
      case 'selectPrint':
        await this.styleManager.setActivePrintProfile(msg.id);
        await this.onChanged();
        await this.refresh();
        break;
      case 'selectSyntax':
        await this.styleManager.setActiveSyntaxStyle(msg.id);
        await this.onChanged();
        await this.refresh();
        break;
      case 'editStyle': {
        if (msg.id === '__match-editor') break;
        const all = await this.styleManager.listStyles();
        const style = all.find((s) => s.id === msg.id);
        if (style) {
          const copy = { ...style };
          delete (copy as any).builtIn;
          this.panel?.webview.postMessage({ type: 'openEditor', mode: 'style', json: JSON.stringify(copy, null, 2), parentId: msg.id });
        }
        break;
      }
      case 'editPrint': {
        if (msg.id === '__default-pdf') break;
        const all = await this.styleManager.listPrintProfiles();
        const profile = all.find((p) => p.id === msg.id);
        if (profile) {
          const copy = { ...profile };
          delete (copy as any).builtIn;
          this.panel?.webview.postMessage({ type: 'openEditor', mode: 'print', json: JSON.stringify(copy, null, 2), parentId: msg.id });
        }
        break;
      }
      case 'editSyntax': {
        if (msg.id === '__match-editor-syntax') break;
        const all = await this.styleManager.listSyntaxStyles();
        const syntax = all.find((s) => s.id === msg.id);
        if (syntax) {
          const copy = { ...syntax };
          delete (copy as any).builtIn;
          this.panel?.webview.postMessage({ type: 'openEditor', mode: 'syntax', json: JSON.stringify(copy, null, 2), parentId: msg.id });
        }
        break;
      }
      case 'addStyle':
        this.panel?.webview.postMessage({ type: 'openEditor', mode: 'style', json: starterStyleJson(), parentId: null });
        break;
      case 'addPrint':
        this.panel?.webview.postMessage({ type: 'openEditor', mode: 'print', json: starterPrintJson(), parentId: null });
        break;
      case 'addSyntax':
        this.panel?.webview.postMessage({ type: 'openEditor', mode: 'syntax', json: starterSyntaxJson(), parentId: null });
        break;
      case 'saveStyle': {
        const result = this.styleManager.validateStyleJson(msg.json);
        if (!result.ok || !result.parsed) {
          this.panel?.webview.postMessage({ type: 'validationResult', mode: 'style', ok: false, error: result.error });
          return;
        }
        await this.styleManager.saveStyle(result.parsed);
        await this.styleManager.setActiveStyle(result.parsed.id);
        await this.onChanged();
        await this.refresh();
        this.panel?.webview.postMessage({ type: 'closeEditor', mode: 'style' });
        break;
      }
      case 'savePrint': {
        const result = this.styleManager.validatePrintJson(msg.json);
        if (!result.ok || !result.parsed) {
          this.panel?.webview.postMessage({ type: 'validationResult', mode: 'print', ok: false, error: result.error });
          return;
        }
        await this.styleManager.savePrintProfile(result.parsed);
        await this.styleManager.setActivePrintProfile(result.parsed.id);
        await this.onChanged();
        await this.refresh();
        this.panel?.webview.postMessage({ type: 'closeEditor', mode: 'print' });
        break;
      }
      case 'saveSyntax': {
        const result = this.styleManager.validateSyntaxJson(msg.json);
        if (!result.ok || !result.parsed) {
          this.panel?.webview.postMessage({ type: 'validationResult', mode: 'syntax', ok: false, error: result.error });
          return;
        }
        await this.styleManager.saveSyntaxStyle(result.parsed);
        await this.styleManager.setActiveSyntaxStyle(result.parsed.id);
        await this.onChanged();
        await this.refresh();
        this.panel?.webview.postMessage({ type: 'closeEditor', mode: 'syntax' });
        break;
      }
      case 'validateStyle': {
        const result = this.styleManager.validateStyleJson(msg.json);
        this.panel?.webview.postMessage({ type: 'validationResult', mode: 'style', ok: result.ok, error: result.error });
        break;
      }
      case 'validatePrint': {
        const result = this.styleManager.validatePrintJson(msg.json);
        this.panel?.webview.postMessage({ type: 'validationResult', mode: 'print', ok: result.ok, error: result.error });
        break;
      }
      case 'validateSyntax': {
        const result = this.styleManager.validateSyntaxJson(msg.json);
        this.panel?.webview.postMessage({ type: 'validationResult', mode: 'syntax', ok: result.ok, error: result.error });
        break;
      }
      case 'deleteStyle':
        if (await this.styleManager.deleteStyle(msg.id)) {
          await this.styleManager.setActiveStyle('__match-editor');
          await this.onChanged();
          await this.refresh();
          this.panel?.webview.postMessage({ type: 'closeEditor', mode: 'style' });
        }
        break;
      case 'deletePrint':
        if (await this.styleManager.deletePrintProfile(msg.id)) {
          await this.styleManager.setActivePrintProfile('__default-pdf');
          await this.onChanged();
          await this.refresh();
          this.panel?.webview.postMessage({ type: 'closeEditor', mode: 'print' });
        }
        break;
      case 'deleteSyntax':
        if (await this.styleManager.deleteSyntaxStyle(msg.id)) {
          await this.styleManager.setActiveSyntaxStyle('__match-editor-syntax');
          await this.onChanged();
          await this.refresh();
          this.panel?.webview.postMessage({ type: 'closeEditor', mode: 'syntax' });
        }
        break;
    }
  }

  private getHtml(): string {
    const elementKeysHtml = Object.entries(ELEMENT_KEY_DOCS).map(([k, v]) => `<code>${escapeHtml(k)}</code> \u2014 ${escapeHtml(v)}`).join(', ');
    const printFieldsHtml = [
      '<code>id</code>, <code>name</code>',
      '<code>format</code> (Letter/Legal/A4/A5/Tabloid/Custom)',
      '<code>width</code>, <code>height</code> (for Custom)',
      '<code>landscape</code>',
      '<code>marginTop</code>, <code>marginRight</code>, <code>marginBottom</code>, <code>marginLeft</code>',
      '<code>mirrorMargins</code>',
      '<code>printStyle</code> (id of a document style to use for print)',
      '<code>codeBlocks</code> ({wrap})',
      '<code>images</code> ({defaultAlign, maxWidth})',
      '<code>pageNumbers</code> ({enabled, style, position, startAt, suppressFirstPage})',
    ].join(', ');
    const syntaxTokensHtml = Object.entries(SYNTAX_TOKEN_DOCS).slice(0, 12).map(([k, v]) => `<code>${escapeHtml(k)}</code>`).join(', ') + ', \u2026';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
:root { color-scheme: light dark; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  padding: 1rem 1.25rem;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
h2 { font-size: 1.05rem; font-weight: 600; margin: 0 0 .35rem 0; color: var(--vscode-foreground); }
.help { color: var(--vscode-descriptionForeground); font-size: .85rem; margin-bottom: .75rem; line-height: 1.45; }
.section { margin-bottom: 1.25rem; }
.row { display: flex; align-items: center; gap: .45rem; }
.row label { min-width: 5rem; font-size: .88rem; color: var(--vscode-foreground); }
select {
  flex: 1; font: inherit;
  color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
  padding: .3rem .45rem; border-radius: 3px;
}
button {
  font: inherit; padding: .28rem .65rem; border-radius: 3px;
  border: 1px solid var(--vscode-button-border, transparent); cursor: pointer;
  color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
}
button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
button.danger { background: #c62828; color: #fff; }
button:disabled { opacity: .4; cursor: default; }
.editor-box { display: none; margin-top: .55rem; padding: .65rem; border: 1px solid var(--vscode-panel-border); border-radius: 5px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); }
.editor-box.open { display: block; }
.editor-box h3 { font-size: .95rem; font-weight: 600; margin-bottom: .4rem; color: var(--vscode-foreground); }
.editor-box textarea {
  width: 100%; min-height: 260px; resize: vertical; tab-size: 2;
  font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, .88rem);
  color: var(--vscode-input-foreground, var(--vscode-foreground));
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  padding: .5rem; border-radius: 4px;
}
.editor-box textarea.invalid { border-color: var(--vscode-inputValidation-errorBorder, #e53935); }
.validation { font-size: .82rem; margin-top: .25rem; min-height: 1.2em; }
.validation.ok { color: var(--vscode-terminal-ansiGreen, #4caf50); }
.validation.err { color: var(--vscode-errorForeground, #e53935); }
.editor-actions { display: flex; gap: .4rem; margin-top: .5rem; align-items: center; }
.editor-actions .spacer { flex: 1; }
.ref { margin-top: .55rem; font-size: .78rem; color: var(--vscode-descriptionForeground); line-height: 1.45; }
.ref code { background: rgba(127,127,127,.15); padding: .05rem .2rem; border-radius: 2px; font-family: var(--vscode-editor-font-family); }
.divider { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 1rem 0; }
</style>
</head>
<body>

<div class="section">
  <h2>Document Style</h2>
  <p class="help">Controls how Markdown renders in the canvas. Choose a built-in style or create your own.</p>
  <div class="row">
    <label for="style-sel">Style</label>
    <select id="style-sel"></select>
    <button id="style-edit-btn">Edit</button>
  </div>
  <div class="editor-box" id="style-editor">
    <h3 id="style-editor-title">Edit Style</h3>
    <textarea id="style-json" spellcheck="false"></textarea>
    <div class="validation" id="style-val"></div>
    <div class="editor-actions">
      <button class="primary" id="style-save" disabled>Save</button>
      <button id="style-cancel">Cancel</button>
      <span class="spacer"></span>
      <button class="danger" id="style-delete" style="display:none">Delete</button>
    </div>
    <div class="ref">Supported element keys: ${elementKeysHtml}</div>
  </div>
</div>

<hr class="divider" />

<div class="section">
  <h2>Code Syntax Highlighting</h2>
  <p class="help">Controls how code blocks are colored. Per-language overrides and <code>"highlight": false</code> to disable.</p>
  <div class="row">
    <label for="syntax-sel">Syntax</label>
    <select id="syntax-sel"></select>
    <button id="syntax-edit-btn">Edit</button>
  </div>
  <div class="editor-box" id="syntax-editor">
    <h3 id="syntax-editor-title">Edit Syntax Style</h3>
    <textarea id="syntax-json" spellcheck="false"></textarea>
    <div class="validation" id="syntax-val"></div>
    <div class="editor-actions">
      <button class="primary" id="syntax-save" disabled>Save</button>
      <button id="syntax-cancel">Cancel</button>
      <span class="spacer"></span>
      <button class="danger" id="syntax-delete" style="display:none">Delete</button>
    </div>
    <div class="ref">Token keys: ${syntaxTokensHtml}. Use <code>"highlight": false</code> in default or per-language to disable.</div>
  </div>
</div>

<hr class="divider" />

<div class="section">
  <h2>Print / PDF Style</h2>
  <p class="help">Controls page size, margins, and layout for print/PDF. Use <code>"printStyle"</code> to link a document style.</p>
  <div class="row">
    <label for="print-sel">Print style</label>
    <select id="print-sel"></select>
    <button id="print-edit-btn">Edit</button>
  </div>
  <div class="editor-box" id="print-editor">
    <h3 id="print-editor-title">Edit Print Style</h3>
    <textarea id="print-json" spellcheck="false"></textarea>
    <div class="validation" id="print-val"></div>
    <div class="editor-actions">
      <button class="primary" id="print-save" disabled>Save</button>
      <button id="print-cancel">Cancel</button>
      <span class="spacer"></span>
      <button class="danger" id="print-delete" style="display:none">Delete</button>
    </div>
    <div class="ref">Fields: ${printFieldsHtml}</div>
  </div>
</div>

<script>
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);

// ── Document Style controls ──
const styleSel = $('style-sel'), styleEditBtn = $('style-edit-btn');
const styleEditor = $('style-editor'), styleTitle = $('style-editor-title');
const styleJson = $('style-json'), styleVal = $('style-val');
const styleSave = $('style-save'), styleCancel = $('style-cancel'), styleDelete = $('style-delete');

// ── Print Style controls ──
const printSel = $('print-sel'), printEditBtn = $('print-edit-btn');
const printEditor = $('print-editor'), printTitle = $('print-editor-title');
const printJson = $('print-json'), printVal = $('print-val');
const printSave = $('print-save'), printCancel = $('print-cancel'), printDelete = $('print-delete');

// ── Syntax Style controls ──
const syntaxSel = $('syntax-sel'), syntaxEditBtn = $('syntax-edit-btn');
const syntaxEditor = $('syntax-editor'), syntaxTitle = $('syntax-editor-title');
const syntaxJson = $('syntax-json'), syntaxVal = $('syntax-val');
const syntaxSave = $('syntax-save'), syntaxCancel = $('syntax-cancel'), syntaxDelete = $('syntax-delete');

let state = null;
let styleEditingId = null, printEditingId = null, syntaxEditingId = null;

function render(s) {
  state = s;
  populateDropdown(styleSel, s.styles, s.activeStyleId, 'Add new style\\u2026');
  populateDropdown(printSel, s.printProfiles, s.activePrintId, 'Add new print style\\u2026');
  populateDropdown(syntaxSel, s.syntaxStyles, s.activeSyntaxId, 'Add new syntax style\\u2026');
  styleEditBtn.disabled = s.activeStyleId === '__match-editor';
  printEditBtn.disabled = s.activePrintId === '__default-pdf';
  syntaxEditBtn.disabled = s.activeSyntaxId === '__match-editor-syntax';
}

function populateDropdown(sel, items, activeId, addLabel) {
  sel.innerHTML = '';
  items.forEach(item => {
    const o = document.createElement('option');
    o.value = item.id; o.textContent = item.name;
    if (item.id === activeId) o.selected = true;
    sel.appendChild(o);
  });
  const add = document.createElement('option');
  add.value = '__add__'; add.textContent = addLabel;
  sel.appendChild(add);
}

styleSel.addEventListener('change', () => {
  if (styleSel.value === '__add__') { vscode.postMessage({ type: 'addStyle' }); styleSel.value = state.activeStyleId; }
  else vscode.postMessage({ type: 'selectStyle', id: styleSel.value });
});
printSel.addEventListener('change', () => {
  if (printSel.value === '__add__') { vscode.postMessage({ type: 'addPrint' }); printSel.value = state.activePrintId; }
  else vscode.postMessage({ type: 'selectPrint', id: printSel.value });
});
syntaxSel.addEventListener('change', () => {
  if (syntaxSel.value === '__add__') { vscode.postMessage({ type: 'addSyntax' }); syntaxSel.value = state.activeSyntaxId; }
  else vscode.postMessage({ type: 'selectSyntax', id: syntaxSel.value });
});

styleEditBtn.addEventListener('click', () => vscode.postMessage({ type: 'editStyle', id: styleSel.value }));
printEditBtn.addEventListener('click', () => vscode.postMessage({ type: 'editPrint', id: printSel.value }));
syntaxEditBtn.addEventListener('click', () => vscode.postMessage({ type: 'editSyntax', id: syntaxSel.value }));

styleCancel.addEventListener('click', () => closeBox('style'));
printCancel.addEventListener('click', () => closeBox('print'));
syntaxCancel.addEventListener('click', () => closeBox('syntax'));

styleSave.addEventListener('click', () => vscode.postMessage({ type: 'saveStyle', json: styleJson.value }));
printSave.addEventListener('click', () => vscode.postMessage({ type: 'savePrint', json: printJson.value }));
syntaxSave.addEventListener('click', () => vscode.postMessage({ type: 'saveSyntax', json: syntaxJson.value }));

styleDelete.addEventListener('click', () => { if (styleEditingId) vscode.postMessage({ type: 'deleteStyle', id: styleEditingId }); });
printDelete.addEventListener('click', () => { if (printEditingId) vscode.postMessage({ type: 'deletePrint', id: printEditingId }); });
syntaxDelete.addEventListener('click', () => { if (syntaxEditingId) vscode.postMessage({ type: 'deleteSyntax', id: syntaxEditingId }); });

let styleTimer = null, printTimer = null, syntaxTimer = null;
styleJson.addEventListener('input', () => { clearTimeout(styleTimer); styleTimer = setTimeout(() => vscode.postMessage({ type: 'validateStyle', json: styleJson.value }), 200); });
printJson.addEventListener('input', () => { clearTimeout(printTimer); printTimer = setTimeout(() => vscode.postMessage({ type: 'validatePrint', json: printJson.value }), 200); });
syntaxJson.addEventListener('input', () => { clearTimeout(syntaxTimer); syntaxTimer = setTimeout(() => vscode.postMessage({ type: 'validateSyntax', json: syntaxJson.value }), 200); });

function getControls(mode) {
  if (mode === 'style') return { box: styleEditor, ta: styleJson, title: styleTitle, val: styleVal, del: styleDelete };
  if (mode === 'print') return { box: printEditor, ta: printJson, title: printTitle, val: printVal, del: printDelete };
  return { box: syntaxEditor, ta: syntaxJson, title: syntaxTitle, val: syntaxVal, del: syntaxDelete };
}

function openBox(mode, json, parentId) {
  const { box, ta, title, val, del } = getControls(mode);
  ta.value = json;
  ta.classList.remove('invalid');
  val.textContent = '';
  const labels = { style: 'Document Style', print: 'Print Style', syntax: 'Syntax Style' };
  title.textContent = parentId ? 'Edit ' + labels[mode] : 'New ' + labels[mode];
  box.classList.add('open');

  let editId = null;
  try { editId = JSON.parse(json).id || null; } catch {}
  if (mode === 'style') styleEditingId = editId;
  else if (mode === 'print') printEditingId = editId;
  else syntaxEditingId = editId;

  const collection = mode === 'style' ? state?.styles : mode === 'print' ? state?.printProfiles : state?.syntaxStyles;
  const isUserOwned = editId && collection?.some(s => s.id === editId && !s.builtIn);
  del.style.display = isUserOwned ? '' : 'none';

  const validateType = mode === 'style' ? 'validateStyle' : mode === 'print' ? 'validatePrint' : 'validateSyntax';
  vscode.postMessage({ type: validateType, json });
  ta.focus();
}

function closeBox(mode) {
  getControls(mode).box.classList.remove('open');
  if (mode === 'style') styleEditingId = null;
  else if (mode === 'print') printEditingId = null;
  else syntaxEditingId = null;
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'state') render(msg.state);
  else if (msg.type === 'openEditor') openBox(msg.mode, msg.json, msg.parentId);
  else if (msg.type === 'closeEditor') closeBox(msg.mode);
  else if (msg.type === 'validationResult') {
    const { ta, val } = getControls(msg.mode);
    const save = msg.mode === 'style' ? styleSave : msg.mode === 'print' ? printSave : syntaxSave;
    if (msg.ok) { val.className = 'validation ok'; val.textContent = 'Valid JSON'; ta.classList.remove('invalid'); save.disabled = false; }
    else { val.className = 'validation err'; val.textContent = msg.error || 'Invalid'; ta.classList.add('invalid'); save.disabled = true; }
  }
});

vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
