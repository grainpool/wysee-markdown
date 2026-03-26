import * as path from 'path';
import * as vscode from 'vscode';
import { StyleProfile, PrintProfile, SyntaxStyleProfile, STYLE_ELEMENT_KEYS } from '../types';
import { ensureDir, pathExists, readJsonFile, writeJsonFile } from '../util/files';
import { TraceService } from '../diagnostics/trace';
import { sanitizeStyleDeclarations } from '../theme/sanitizeStyleDeclarations';
import {
  BUILTIN_STYLES, BUILTIN_PRINT_PROFILES, BUILTIN_SYNTAX_STYLES,
  MATCH_EDITOR_THEME, MATCH_EDITOR_SYNTAX, DEFAULT_PDF,
  DEFAULT_ELEMENT_STYLES, DEFAULT_BASE_STYLES,
  ELEMENT_KEY_DOCS, SYNTAX_TOKEN_DOCS,
} from './styleDefaults';

export class StyleManager {
  readonly extensionPath: string;
  private readonly globalStylesDir: string;
  private readonly globalPrintDir: string;
  private readonly globalSyntaxDir: string;

  constructor(private readonly context: vscode.ExtensionContext, private readonly trace: TraceService) {
    this.extensionPath = context.extensionPath;
    this.globalStylesDir = path.join(context.globalStorageUri.fsPath, 'styles');
    this.globalPrintDir = path.join(context.globalStorageUri.fsPath, 'print-profiles');
    this.globalSyntaxDir = path.join(context.globalStorageUri.fsPath, 'syntax-styles');
  }

  async initialize(): Promise<void> {
    await ensureDir(this.globalStylesDir);
    await ensureDir(this.globalPrintDir);
    await ensureDir(this.globalSyntaxDir);
  }

  // ── Document Styles ────────────────────────────────────────

  async listStyles(uri?: vscode.Uri): Promise<StyleProfile[]> {
    const userStyles = await this.loadJsonDir<StyleProfile>(this.globalStylesDir);
    const wsDir = this.workspaceStylesDir(uri);
    const wsStyles = wsDir ? await this.loadJsonDir<StyleProfile>(wsDir) : [];
    const all = new Map<string, StyleProfile>();
    for (const s of [...BUILTIN_STYLES, ...userStyles, ...wsStyles]) {
      if (s?.id) { all.set(s.id, s); }
    }
    const sorted = [...all.values()].sort((a, b) => {
      if (a.id === MATCH_EDITOR_THEME.id) return -1;
      if (b.id === MATCH_EDITOR_THEME.id) return 1;
      if (a.builtIn && !b.builtIn) return -1;
      if (!a.builtIn && b.builtIn) return 1;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }

  async getActiveStyle(uri?: vscode.Uri): Promise<StyleProfile> {
    const id = vscode.workspace.getConfiguration('wyseeMd', uri).get<string>('style.active', MATCH_EDITOR_THEME.id);
    const all = await this.listStyles(uri);
    return all.find((s) => s.id === id) ?? MATCH_EDITOR_THEME;
  }

  async setActiveStyle(id: string, uri?: vscode.Uri): Promise<void> {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    await vscode.workspace.getConfiguration('wyseeMd', uri).update('style.active', id, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
  }

  async saveStyle(profile: StyleProfile): Promise<void> {
    const file = path.join(this.globalStylesDir, `${profile.id}.json`);
    await writeJsonFile(file, profile);
    this.trace.info('Saved style', { id: profile.id });
  }

  async deleteStyle(id: string): Promise<boolean> {
    const file = path.join(this.globalStylesDir, `${id}.json`);
    if (await pathExists(file)) {
      const fs = await import('fs/promises');
      await fs.unlink(file);
      return true;
    }
    return false;
  }

  /**
   * Resolves a StyleProfile into a fully-specified style by merging user
   * elementStyles over the built-in defaults.  Missing keys get fallback values.
   */
  resolveStyle(style: StyleProfile): { baseStyles: string; elementStyles: Record<string, string> } {
    const merged: Record<string, string> = { ...DEFAULT_ELEMENT_STYLES };
    for (const [key, value] of Object.entries(style.elementStyles)) {
      if (value && value.trim()) {
        merged[key] = value;
      }
    }
    return {
      baseStyles: style.baseStyles || DEFAULT_BASE_STYLES,
      elementStyles: merged,
    };
  }

  /** Convert a StyleProfile into the legacy ThemeProfile shape for the compiler. */
  toLegacyTheme(style: StyleProfile): any {
    const resolved = this.resolveStyle(style);
    return {
      id: style.id,
      name: style.name,
      selectorStyles: { body: resolved.baseStyles, ...resolved.elementStyles },
    };
  }

  // ── Print Profiles ─────────────────────────────────────────

  async listPrintProfiles(uri?: vscode.Uri): Promise<PrintProfile[]> {
    const userProfiles = await this.loadJsonDir<PrintProfile>(this.globalPrintDir);
    const wsDir = this.workspacePrintDir(uri);
    const wsProfiles = wsDir ? await this.loadJsonDir<PrintProfile>(wsDir) : [];
    const all = new Map<string, PrintProfile>();
    for (const p of [...BUILTIN_PRINT_PROFILES, ...userProfiles, ...wsProfiles]) {
      if (p?.id) { all.set(p.id, p); }
    }
    const sorted = [...all.values()].sort((a, b) => {
      if (a.id === DEFAULT_PDF.id) return -1;
      if (b.id === DEFAULT_PDF.id) return 1;
      if (a.builtIn && !b.builtIn) return -1;
      if (!a.builtIn && b.builtIn) return 1;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }

  async getActivePrintProfile(uri?: vscode.Uri): Promise<PrintProfile> {
    const id = vscode.workspace.getConfiguration('wyseeMd', uri).get<string>('printProfile.active', DEFAULT_PDF.id);
    const all = await this.listPrintProfiles(uri);
    return all.find((p) => p.id === id) ?? DEFAULT_PDF;
  }

  async setActivePrintProfile(id: string, uri?: vscode.Uri): Promise<void> {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    await vscode.workspace.getConfiguration('wyseeMd', uri).update('printProfile.active', id, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
  }

  async savePrintProfile(profile: PrintProfile): Promise<void> {
    const file = path.join(this.globalPrintDir, `${profile.id}.json`);
    await writeJsonFile(file, profile);
    this.trace.info('Saved print profile', { id: profile.id });
  }

  async deletePrintProfile(id: string): Promise<boolean> {
    const file = path.join(this.globalPrintDir, `${id}.json`);
    if (await pathExists(file)) {
      const fs = await import('fs/promises');
      await fs.unlink(file);
      return true;
    }
    return false;
  }

  /** Resolve a PrintProfile's linked style (via printStyle field). */
  async resolveLinkedStyle(profile: PrintProfile, uri?: vscode.Uri): Promise<StyleProfile> {
    if (profile.printStyle) {
      const all = await this.listStyles(uri);
      const linked = all.find((s) => s.id === profile.printStyle);
      if (linked) return linked;
    }
    return await this.getActiveStyle(uri);
  }

  /** Convert a PrintProfile into the legacy PageProfile shape for the compiler. */
  toLegacyPageProfile(profile: PrintProfile): any {
    return {
      id: profile.id,
      name: profile.name,
      format: profile.format,
      width: profile.width,
      height: profile.height,
      landscape: profile.landscape,
      marginTop: profile.marginTop,
      marginRight: profile.marginRight,
      marginBottom: profile.marginBottom,
      marginLeft: profile.marginLeft,
      mirrorMargins: profile.mirrorMargins,
      pageNumbers: profile.pageNumbers,
      codeBlocks: profile.codeBlocks ?? { wrap: true },
      images: profile.images ?? { defaultAlign: 'center', maxWidth: '100%' },
    };
  }

  // ── Validation ─────────────────────────────────────────────

  validateStyleJson(text: string): { ok: boolean; error?: string; parsed?: StyleProfile } {
    let parsed: any;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }; }
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'JSON must be an object.' };
    if (!parsed.id || typeof parsed.id !== 'string') return { ok: false, error: 'Missing required field "id" (string).' };
    if (!parsed.name || typeof parsed.name !== 'string') return { ok: false, error: 'Missing required field "name" (string).' };
    if (parsed.id === '__match-editor') return { ok: false, error: 'Cannot overwrite the "Match Editor Theme" built-in style.' };
    if (parsed.elementStyles && typeof parsed.elementStyles === 'object') {
      for (const key of Object.keys(parsed.elementStyles)) {
        if (!(key in ELEMENT_KEY_DOCS)) {
          return { ok: false, error: `Unknown element key "${key}". Supported keys: ${Object.keys(ELEMENT_KEY_DOCS).join(', ')}` };
        }
      }
    }
    return { ok: true, parsed: parsed as StyleProfile };
  }

  validatePrintJson(text: string): { ok: boolean; error?: string; parsed?: PrintProfile } {
    let parsed: any;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }; }
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'JSON must be an object.' };
    if (!parsed.id || typeof parsed.id !== 'string') return { ok: false, error: 'Missing required field "id" (string).' };
    if (!parsed.name || typeof parsed.name !== 'string') return { ok: false, error: 'Missing required field "name" (string).' };
    if (parsed.id === '__default-pdf') return { ok: false, error: 'Cannot overwrite the "Default PDF" built-in profile.' };
    const validFormats = ['Letter', 'Legal', 'A4', 'A5', 'Tabloid', 'Custom'];
    if (parsed.format && !validFormats.includes(parsed.format)) {
      return { ok: false, error: `Invalid format "${parsed.format}". Must be one of: ${validFormats.join(', ')}` };
    }
    return { ok: true, parsed: parsed as PrintProfile };
  }

  // ── Syntax Styles ──────────────────────────────────────────

  async listSyntaxStyles(uri?: vscode.Uri): Promise<SyntaxStyleProfile[]> {
    const userStyles = await this.loadJsonDir<SyntaxStyleProfile>(this.globalSyntaxDir);
    const wsDir = this.workspaceSyntaxDir(uri);
    const wsStyles = wsDir ? await this.loadJsonDir<SyntaxStyleProfile>(wsDir) : [];
    const all = new Map<string, SyntaxStyleProfile>();
    for (const s of [...BUILTIN_SYNTAX_STYLES, ...userStyles, ...wsStyles]) {
      if (s?.id) all.set(s.id, s);
    }
    return [...all.values()].sort((a, b) => {
      if (a.id === MATCH_EDITOR_SYNTAX.id) return -1;
      if (b.id === MATCH_EDITOR_SYNTAX.id) return 1;
      if (a.builtIn && !b.builtIn) return -1;
      if (!a.builtIn && b.builtIn) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  async getActiveSyntaxStyle(uri?: vscode.Uri): Promise<SyntaxStyleProfile> {
    const id = vscode.workspace.getConfiguration('wyseeMd', uri).get<string>('syntaxStyle.active', MATCH_EDITOR_SYNTAX.id);
    const all = await this.listSyntaxStyles(uri);
    return all.find(s => s.id === id) ?? MATCH_EDITOR_SYNTAX;
  }

  async setActiveSyntaxStyle(id: string, uri?: vscode.Uri): Promise<void> {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined;
    await vscode.workspace.getConfiguration('wyseeMd', uri).update('syntaxStyle.active', id, folder ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Global);
  }

  async saveSyntaxStyle(profile: SyntaxStyleProfile): Promise<void> {
    const filePath = path.join(this.globalSyntaxDir, `${profile.id}.json`);
    await writeJsonFile(filePath, profile);
  }

  async deleteSyntaxStyle(id: string): Promise<boolean> {
    if (BUILTIN_SYNTAX_STYLES.some(s => s.id === id)) return false;
    const filePath = path.join(this.globalSyntaxDir, `${id}.json`);
    if (await pathExists(filePath)) {
      await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
      return true;
    }
    return false;
  }

  /** Resolve a syntax style from a document style's syntaxStyle link, or the active syntax style */
  async resolveLinkedSyntaxStyle(docStyle: StyleProfile, uri?: vscode.Uri): Promise<SyntaxStyleProfile> {
    if (docStyle.syntaxStyle) {
      const all = await this.listSyntaxStyles(uri);
      const linked = all.find(s => s.id === docStyle.syntaxStyle);
      if (linked) return linked;
    }
    return this.getActiveSyntaxStyle(uri);
  }

  /** Compile a SyntaxStyleProfile into CSS */
  compileSyntaxStyleCss(profile: SyntaxStyleProfile): string {
    const lines: string[] = [];
    const defaults = profile.syntaxStyles.default ?? {};

    // Check global highlight kill switch
    if (defaults.highlight === false) return '';

    // Token-to-hljs-class mapping
    const tokenClassMap: Record<string, string[]> = {
      keyword: ['hljs-keyword', 'hljs-selector-tag'],
      builtIn: ['hljs-built_in'],
      type: ['hljs-type'],
      literal: ['hljs-literal'],
      string: ['hljs-string', 'hljs-template-variable'],
      regexp: ['hljs-regexp'],
      number: ['hljs-number'],
      variable: ['hljs-variable'],
      operator: ['hljs-operator'],
      punctuation: ['hljs-punctuation'],
      property: ['hljs-property'],
      comment: ['hljs-comment', 'hljs-quote'],
      doctag: ['hljs-doctag'],
      function: ['hljs-title.function_'],
      title: ['hljs-title', 'hljs-section'],
      titleClass: ['hljs-title.class_'],
      params: ['hljs-params'],
      attr: ['hljs-attr'],
      attribute: ['hljs-attribute'],
      selector: ['hljs-selector-id', 'hljs-selector-class'],
      selectorAttr: ['hljs-selector-attr'],
      selectorPseudo: ['hljs-selector-pseudo'],
      tag: ['hljs-tag', 'hljs-name'],
      name: ['hljs-name'],
      meta: ['hljs-meta'],
      symbol: ['hljs-symbol', 'hljs-bullet'],
      bullet: ['hljs-bullet'],
      link: ['hljs-link'],
      subst: ['hljs-subst'],
      code: ['hljs-code'],
      formula: ['hljs-formula'],
      variableLanguage: ['hljs-variable.language_'],
      variableConstant: ['hljs-variable.constant_'],
      charEscape: ['hljs-char.escape_'],
      addition: ['hljs-addition'],
      deletion: ['hljs-deletion'],
      emphasis: ['hljs-emphasis'],
      strong: ['hljs-strong'],
    };

    // Emit default token styles
    for (const [token, css] of Object.entries(defaults)) {
      if (token === 'highlight' || typeof css !== 'string' || !css.trim()) continue;
      const classes = tokenClassMap[token];
      if (!classes) continue;
      const sanitized = sanitizeStyleDeclarations(css);
      if (!sanitized) continue;
      const selectors = classes.map(c => `.wysee-block pre code .${c}`).join(', ');
      lines.push(`${selectors} { ${sanitized} }`);
    }

    // Emit per-language overrides
    for (const [lang, langStyle] of Object.entries(profile.syntaxStyles)) {
      if (lang === 'default' || !langStyle) continue;
      // Per-language highlight kill switch
      if (langStyle.highlight === false) {
        lines.push(`.wysee-block pre code.language-${lang} .hljs-keyword, .wysee-block pre code.language-${lang} .hljs-string, .wysee-block pre code.language-${lang} .hljs-comment, .wysee-block pre code.language-${lang} .hljs-number, .wysee-block pre code.language-${lang} .hljs-title, .wysee-block pre code.language-${lang} .hljs-built_in, .wysee-block pre code.language-${lang} .hljs-type, .wysee-block pre code.language-${lang} .hljs-variable, .wysee-block pre code.language-${lang} .hljs-attr, .wysee-block pre code.language-${lang} .hljs-meta, .wysee-block pre code.language-${lang} [class^="hljs-"] { color: inherit; font-style: inherit; font-weight: inherit; background: none; }`);
        continue;
      }
      for (const [token, css] of Object.entries(langStyle)) {
        if (token === 'highlight' || typeof css !== 'string' || !css.trim()) continue;
        const classes = tokenClassMap[token];
        if (!classes) continue;
        const sanitized = sanitizeStyleDeclarations(css);
        if (!sanitized) continue;
        const selectors = classes.map(c => `.wysee-block pre code.language-${lang} .${c}`).join(', ');
        lines.push(`${selectors} { ${sanitized} }`);
      }
    }

    return lines.join('\n');
  }

  validateSyntaxJson(text: string): { ok: boolean; error?: string; parsed?: SyntaxStyleProfile } {
    let parsed: any;
    try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }; }
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'JSON must be an object.' };
    if (!parsed.id || typeof parsed.id !== 'string') return { ok: false, error: 'Missing required field "id" (string).' };
    if (!parsed.name || typeof parsed.name !== 'string') return { ok: false, error: 'Missing required field "name" (string).' };
    if (!parsed.syntaxStyles || typeof parsed.syntaxStyles !== 'object') return { ok: false, error: 'Missing required field "syntaxStyles" (object).' };
    return { ok: true, parsed: parsed as SyntaxStyleProfile };
  }

  // ── Helpers ────────────────────────────────────────────────

  private async loadJsonDir<T>(dir: string): Promise<T[]> {
    const results: T[] = [];
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
        const item = await readJsonFile<T>(path.join(dir, name));
        if (item) results.push(item);
      }
    } catch { /* directory may not exist yet */ }
    return results;
  }

  private workspaceStylesDir(uri?: vscode.Uri): string | undefined {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    return path.join(folder.uri.fsPath, '.vscode', 'wysee-md', 'styles');
  }

  private workspacePrintDir(uri?: vscode.Uri): string | undefined {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    return path.join(folder.uri.fsPath, '.vscode', 'wysee-md', 'print-profiles');
  }

  private workspaceSyntaxDir(uri?: vscode.Uri): string | undefined {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;
    return path.join(folder.uri.fsPath, '.vscode', 'wysee-md', 'syntax-styles');
  }
}
