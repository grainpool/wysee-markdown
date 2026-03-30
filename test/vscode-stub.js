const fs = require('fs/promises');
const path = require('path');

class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(start, end) { this.start = start; this.end = end; }
  intersection(other) {
    const aStart = this.start.line * 1e6 + this.start.character;
    const aEnd = this.end.line * 1e6 + this.end.character;
    const bStart = other.start.line * 1e6 + other.start.character;
    const bEnd = other.end.line * 1e6 + other.end.character;
    if (aEnd < bStart || bEnd < aStart) return undefined;
    return new Range(this.start, this.end);
  }
}
class Selection extends Range {
  constructor(start, end) { super(start, end); this.active = end; }
}
class Uri {
  constructor(fsPath) { this.fsPath = fsPath; this.path = fsPath; }
  toString() { return `file://${this.fsPath}`; }
  with(parts) { return new Uri(parts.path || this.fsPath); }
  static file(fsPath) { return new Uri(fsPath); }
  static parse(value) { return new Uri(value.replace(/^file:\/\//, '')); }
  static joinPath(base, ...parts) { return new Uri(path.join(base.fsPath, ...parts)); }
}
class Diagnostic {
  constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; }
}
class DiagnosticRelatedInformation {
  constructor(location, message) { this.location = location; this.message = message; }
}
class Location {
  constructor(uri, range) { this.uri = uri; this.range = range; }
}
class WorkspaceEdit {
  constructor() { this.edits = []; }
  replace(uri, range, text) { this.edits.push({ type: 'replace', uri, range, text }); }
  insert(uri, position, text) { this.edits.push({ type: 'insert', uri, position, text }); }
}
class DiagnosticCollection {
  constructor() { this.map = new Map(); }
  set(uri, diagnostics) { this.map.set(uri.toString(), diagnostics); }
  get(uri) { return this.map.get(uri.toString()); }
  clear() { this.map.clear(); }
}
class LogOutputChannel {
  trace() {}
  debug() {}
  info() {}
  warn() {}
  error() {}
  show() {}
  dispose() {}
}

class CodeAction {
  constructor(title, kind) { this.title = title; this.kind = kind; }
}


const state = {
  config: {
    wyseeMd: {
      'spell.language': 'en-US',
      'export.html.selfContained': false,
      'preview.editable': true,
      'preview.commitOnBlur': false,
      'preview.insertRelativeToBlock': 'after',
      'style.active': '__match-editor',
      'printProfile.active': '__default-pdf',
      'spell.workspaceDictionaryPath': '.vscode/wysee-md/dictionary.txt',
      'print.browserFamily': 'system',
      'print.browserPath': '',
      'print.adapterOrder': ['configuredBrowser', 'systemBrowser', 'osOpen'],
      'trace.level': 'info',
    },
    workbench: { 'editorAssociations': [] },
  },
  docs: new Map(),
  workspaceFolders: [
    { uri: Uri.file(process.cwd()), name: path.basename(process.cwd()), index: 0 },
  ],
  isTrusted: true,
};

function getConfig(section) {
  const bucket = state.config[section] || {};
  return {
    get(key, defaultValue) { return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : defaultValue; },
    async update(key, value) { bucket[key] = value; },
  };
}

const workspace = {
  workspaceFolders: state.workspaceFolders,
  isTrusted: true,
  getConfiguration(section) { return getConfig(section); },
  getWorkspaceFolder(uri) { return state.workspaceFolders.find((folder) => uri.fsPath.startsWith(folder.uri.fsPath)) || state.workspaceFolders[0]; },
  fs: {
    async readDirectory(uri) {
      const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((entry) => [entry.name, entry.isDirectory() ? 2 : 1]);
    },
  },
  async openTextDocument(input) {
    if (typeof input === 'object' && input.content !== undefined) {
      return createTextDocument(Uri.file('/tmp/untitled'), input.content, 'plaintext');
    }
    const uri = input instanceof Uri ? input : Uri.parse(String(input));
    if (state.docs.has(uri.toString())) return state.docs.get(uri.toString());
    const text = await fs.readFile(uri.fsPath, 'utf8');
    const doc = createTextDocument(uri, text, 'markdown');
    state.docs.set(uri.toString(), doc);
    return doc;
  },
  async applyEdit(edit) {
    for (const item of edit.edits) {
      const doc = state.docs.get(item.uri.toString()) || await workspace.openTextDocument(item.uri);
      if (item.type === 'replace') {
        const start = doc.offsetAt(item.range.start);
        const end = doc.offsetAt(item.range.end);
        doc.__setText(doc.getText().slice(0, start) + item.text + doc.getText().slice(end));
      }
      if (item.type === 'insert') {
        const off = doc.offsetAt(item.position);
        doc.__setText(doc.getText().slice(0, off) + item.text + doc.getText().slice(off));
      }
    }
    return true;
  },
  onDidChangeTextDocument() { return { dispose() {} }; },
  onDidOpenTextDocument() { return { dispose() {} }; },
  onDidSaveTextDocument() { return { dispose() {} }; },
  onDidChangeConfiguration() { return { dispose() {} }; },
};

const languages = { createDiagnosticCollection() { return new DiagnosticCollection(); }, registerCodeActionsProvider() { return { dispose() {} }; } };
const window = {
  createOutputChannel() { return new LogOutputChannel(); },
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  showSaveDialog: async () => undefined,
  showTextDocument: async (document) => ({ document, selection: new Selection(new Position(0, 0), new Position(0, 0)), revealRange() {} }),
  registerCustomEditorProvider() { return { dispose() {} }; },
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor() { return { dispose() {} }; },
  tabGroups: {
    all: [],
    activeTabGroup: undefined,
    onDidChangeTabs() { return { dispose() {} }; },
    onDidChangeTabGroups() { return { dispose() {} }; },
  },
};
const commands = { async executeCommand() { return undefined; }, registerCommand() { return { dispose() {} }; } };
const env = { async openExternal() { return true; }, remoteName: undefined };
const extensions = { getExtension() { return undefined; } };

function createTextDocument(uri, text, languageId = 'markdown') {
  let value = text;
  const doc = {
    uri,
    version: 1,
    languageId,
    getText(range) {
      if (!range) return value;
      const start = this.offsetAt(range.start);
      const end = this.offsetAt(range.end);
      return value.slice(start, end);
    },
    positionAt(offset) {
      const lines = value.slice(0, offset).split(/\r?\n/);
      const line = lines.length - 1;
      const character = lines[lines.length - 1].length;
      return new Position(line, character);
    },
    offsetAt(position) {
      const lines = value.split(/\r?\n/);
      let offset = 0;
      for (let i = 0; i < position.line; i += 1) offset += lines[i].length + 1;
      return offset + position.character;
    },
    async save() { return true; },
    __setText(next) { value = next; this.version += 1; },
    lineCount: value.split(/\r?\n/).length,
  };
  return doc;
}

module.exports = {
  Position,
  Range,
  Selection,
  Uri,
  Diagnostic,
  DiagnosticRelatedInformation,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  DiagnosticRelatedInformation,
  Location,
  WorkspaceEdit,
  CodeAction,
  CodeActionKind: { QuickFix: 'quickfix' },
  FileType: { File: 1, Directory: 2 },
  ViewColumn: { Beside: 2 },
  TextEditorRevealType: { InCenter: 0 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace,
  window,
  commands,
  languages,
  env,
  extensions,
  __state: state,
  __createTextDocument: createTextDocument,
  __registerDocument(uri, text, languageId='markdown') { const doc=createTextDocument(uri,text,languageId); state.docs.set(uri.toString(), doc); return doc; },
};
