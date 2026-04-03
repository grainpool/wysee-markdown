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
import { parseHTML } from 'linkedom';
import { BlockMapEntry, RenderViewModel, RenderedBlockModel } from '../types';
import { buildBlockMap } from './blockMap';
import { applyImageAttributeSyntax, parseImageAttributeSyntax } from './attributeSyntax';
import { directivePrintClass, renderDirectiveHint } from './directives';
import { renderMermaidBlock } from './mermaidTransform';
import { sanitizeRenderedHtml } from './sanitizeHtml';
import { escapeHtml } from '../util/strings';
import { TraceService } from '../diagnostics/trace';
import { ThemeService } from '../theme/themeService';
import { PageProfileService } from '../theme/pageProfileService';
import { SpellService } from '../spell/spellService';
import { StyleManager } from '../style/styleManager';
import { uriBasename } from '../util/uris';

export type RenderMode = 'webview' | 'print' | 'export';

export interface RenderOptions {
  mode: RenderMode;
  webview?: vscode.Webview;
  trusted: boolean;
}

export interface RenderDependencies {
  trace: TraceService;
  themeService: ThemeService;
  pageProfileService: PageProfileService;
  spellService: SpellService;
  styleManager: StyleManager;
}

export class MarkdownRenderer {
  private readonly md: MarkdownIt;
  private _disabledLangs = new Set<string>();
  private _highlightGloballyDisabled = false;

  constructor(private readonly deps: RenderDependencies) {
    let highlightFn: ((code: string, lang: string) => string) | undefined;
    try {
      const hljs = require('highlight.js');
      highlightFn = (code: string, lang: string): string => {
        const enabled = vscode.workspace.getConfiguration('wyseeMd').get<boolean>('preview.syntaxHighlight', true);
        if (!enabled || this._highlightGloballyDisabled) return '';
        if (lang && this._disabledLangs.has(lang)) return '';
        if (lang && hljs.getLanguage(lang)) {
          try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* fall through */ }
        }
        return '';
      };
    } catch {
      // highlight.js not available
    }
    this.md = new MarkdownIt({ html: true, linkify: true, breaks: false, highlight: highlightFn });
    this.md.use(markdownItTaskLists, { enabled: true, label: true });
  }

  async renderDocumentToViewModel(document: vscode.TextDocument, options: RenderOptions): Promise<RenderViewModel> {
    const blockMap = buildBlockMap(document);
    const theme = await this.deps.themeService.getActiveTheme(document.uri);
    const pageProfile = await this.deps.pageProfileService.getActivePageProfile(document.uri);

    // ── Resolve syntax style and configure highlight function ──
    const activeDocStyle = await this.deps.styleManager.getActiveStyle(document.uri);
    const syntaxProfile = await this.deps.styleManager.resolveLinkedSyntaxStyle(activeDocStyle, document.uri);
    // Update per-render disabled languages for the highlight function
    this._disabledLangs.clear();
    this._highlightGloballyDisabled = syntaxProfile.syntaxStyles.default?.highlight === false;
    for (const [lang, langStyle] of Object.entries(syntaxProfile.syntaxStyles)) {
      if (lang !== 'default' && langStyle?.highlight === false) this._disabledLangs.add(lang);
    }
    const syntaxCss = this.deps.styleManager.compileSyntaxStyleCss(syntaxProfile);

    // ── Build footnote registry from definition blocks ──
    const footnoteRegistry = buildFootnoteRegistry(blockMap);

    const blocks: Record<string, RenderedBlockModel> = {};
    const htmlParts: string[] = [];

    for (const block of blockMap) {
      if (block.kind === 'footnoteDefinition') {
        // Footnote definitions are rendered in the footnotes section, not inline
        const emptyHtml = `<div data-wysee-block-id="${escapeHtml(block.blockId)}" data-wysee-kind="footnoteDefinition" data-wysee-start-line="${block.startLine}" data-wysee-end-line="${block.endLine}" class="wysee-block wysee-block-footnoteDefinition" style="display:none"></div>`;
        blocks[block.blockId] = { blockId: block.blockId, kind: 'footnoteDefinition', startLine: block.startLine, endLine: block.endLine, raw: block.raw, plainText: block.raw, html: emptyHtml };
        htmlParts.push(emptyHtml);
        continue;
      }
      const rendered = await this.renderBlock(document, block, options);
      let html = rendered.html;

      // ── Fix ordered list start number ──
      if (block.kind === 'listItem' && block.meta?.ordered) {
        const startNum = block.raw.match(/^\s*(\d+)[.)]/)?.[1];
        if (startNum) {
          // Belt-and-suspenders: set both ol start and li value
          html = html.replace(/<ol(?:\s[^>]*)?>/, (m) => m.includes('start=') ? m : m.replace(/<ol/, `<ol start="${escapeHtml(startNum)}"`));
          html = html.replace(/<li>/, `<li value="${escapeHtml(startNum)}">`);
        }
      }

      // ── Resolve footnote references [^N] → superscript ──
      html = resolveFootnoteReferences(html, footnoteRegistry);

      const patched = { ...rendered, html };
      blocks[block.blockId] = patched;
      htmlParts.push(html);
    }

    // ── Append footnotes section ──
    if (footnoteRegistry.size > 0) {
      const fnHtml = renderFootnotesSection(footnoteRegistry);
      const fnBlockId = 'b:footnotes';
      const fnWrapped = `<div data-wysee-block-id="${fnBlockId}" data-wysee-kind="footnotes" class="wysee-block wysee-block-footnotes">${fnHtml}</div>`;
      htmlParts.push(fnWrapped);
      blocks[fnBlockId] = { blockId: fnBlockId, kind: 'footnotes', startLine: -1, endLine: -1, raw: '', plainText: '', html: fnWrapped };
    }

    return {
      uri: document.uri.toString(),
      version: document.version,
      title: uriBasename(document.uri),
      html: htmlParts.join('\n'),
      themeCss: this.deps.themeService.compileThemeToPreviewCss(theme),
      previewCss: this.deps.themeService.compileThemeToPreviewCss(theme),
      pageCss: this.deps.pageProfileService.compileThemeToPrintCss(theme, pageProfile),
      blocks,
      blockMap,
      activeThemeId: theme.id,
      activePageProfileId: pageProfile.id,
      editable: vscode.workspace.getConfiguration('wyseeMd', document.uri).get<boolean>('preview.editable', true),
      commitOnBlur: vscode.workspace.getConfiguration('wyseeMd', document.uri).get<boolean>('preview.commitOnBlur', false),
      copyMode: vscode.workspace.getConfiguration('wyseeMd', document.uri).get<string>('preview.copyMode', 'plainText') as 'plainText' | 'sourceMarkdown',
      syntaxCss,
      trusted: options.trusted,
    };
  }

  async buildStandaloneHtml(document: vscode.TextDocument, mode: RenderMode, trusted: boolean): Promise<string> {
    const model = await this.renderDocumentToViewModel(document, { mode, trusted });
    const mermaidJs = await fs.readFile(path.join(this.deps.themeService.extensionPath, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'), 'utf8');
    let katexCss = '';
    let katexJs = '';
    try {
      katexCss = await fs.readFile(path.join(this.deps.themeService.extensionPath, 'node_modules', 'katex', 'dist', 'katex.min.css'), 'utf8');
      katexJs = await fs.readFile(path.join(this.deps.themeService.extensionPath, 'node_modules', 'katex', 'dist', 'katex.min.js'), 'utf8');
    } catch { /* katex optional */ }
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(model.title)}</title>
<style>${model.previewCss}\n${model.pageCss}</style>
${katexCss ? `<style>${katexCss}</style>` : ''}
</head>
<body class="wysee-export-body ${escapeHtml(model.activeThemeId)}">
<div id="wysee-root">${model.html}</div>
<script>${mermaidJs}</script>
${katexJs ? `<script>${katexJs}</script>` : ''}
<script>
  (function(){
    if (window.mermaid) {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      document.querySelectorAll('.wysee-mermaid').forEach(async (el, i) => {
        const source = el.getAttribute('data-wysee-mermaid-source') || '';
        try {
          const result = await window.mermaid.render('wysee-export-mermaid-' + i, source);
          el.innerHTML = result.svg;
        } catch (error) {
          el.innerHTML = '<pre class="wysee-mermaid-error">' + String(error) + '</pre>';
        }
      });
    }
    if (window.katex) {
      document.querySelectorAll('.wysee-math').forEach(function(el) {
        var source = el.getAttribute('data-wysee-math-source') || '';
        var displayMode = el.getAttribute('data-wysee-math-display') === 'block';
        try {
          el.innerHTML = window.katex.renderToString(source, { displayMode: displayMode, throwOnError: false, output: 'html' });
        } catch (e) {
          el.innerHTML = '<span class="wysee-math-error">' + String(e) + '</span>';
        }
      });
    }
  })();
</script>
</body>
</html>`;
  }

  private async renderBlock(document: vscode.TextDocument, block: BlockMapEntry, options: RenderOptions): Promise<RenderedBlockModel> {
    let innerHtml = '';
    let plainText = block.raw;
    const imageAttrs = parseImageAttributeSyntax(block.raw);
    if (block.kind === 'directive') {
      const printClass = options.mode !== 'webview' ? directivePrintClass(block.raw) : undefined;
      innerHtml = options.mode === 'webview'
        ? renderDirectiveHint(block.raw)
        : `<div class="${printClass ?? ''}"></div>`;
    } else if (block.kind === 'footnoteDefinition') {
      innerHtml = '';
    } else if (block.kind === 'mermaidFence') {
      innerHtml = renderMermaidBlock(block.raw);
    } else if (block.kind === 'horizontalRule') {
      innerHtml = '<hr />';
    } else {
      const prepared = preprocessMath(applyImageAttributeSyntax(block.raw));
      innerHtml = this.md.render(prepared);
    }

    innerHtml = sanitizeRenderedHtml(innerHtml, this.deps.trace, document.uri.toString());
    innerHtml = await this.decorateHtml(document, block, innerHtml, imageAttrs, options);
    const wrapperAttrs = [
      `data-wysee-block-id="${escapeHtml(block.blockId)}"`,
      `data-wysee-kind="${escapeHtml(block.kind)}"`,
      `data-wysee-start-line="${block.startLine}"`,
      `data-wysee-end-line="${block.endLine}"`,
      `data-vscode-context='{"webviewSection":"wyseeBlock","wyseeBlockKind":"${escapeHtml(block.kind)}"}'`,
      `class="wysee-block wysee-block-${escapeHtml(block.kind)}"`,
    ];
    const indent = block.meta?.indent as number | undefined;
    if (block.kind === 'listItem' && indent && indent > 0) {
      wrapperAttrs.push(`data-wysee-indent="${indent}"`);
      wrapperAttrs.push(`style="margin-left: ${indent * 1.5}rem"`);
    }
    return {
      blockId: block.blockId,
      kind: block.kind,
      startLine: block.startLine,
      endLine: block.endLine,
      raw: block.raw,
      plainText,
      html: `<div ${wrapperAttrs.join(' ')}>${innerHtml}</div>`,
      meta: { imageAttrs, ...(block.meta ?? {}) },
    };
  }

  private async decorateHtml(
    document: vscode.TextDocument,
    block: BlockMapEntry,
    html: string,
    imageAttrs: ReturnType<typeof parseImageAttributeSyntax>,
    options: RenderOptions,
  ): Promise<string> {
    const { document: dom } = parseHTML(`<html><body>${html}</body></html>`);
    let linkIndex = 0;
    let imageIndex = 0;
    let rowIndex = 0;
    dom.querySelectorAll('tr').forEach((row) => {
      let colIndex = 0;
      row.querySelectorAll('th,td').forEach((cell) => {
        cell.setAttribute('data-wysee-cell-row', String(rowIndex));
        cell.setAttribute('data-wysee-cell-col', String(colIndex));
        colIndex += 1;
      });
      rowIndex += 1;
    });
    dom.querySelectorAll('a').forEach((a) => {
      a.setAttribute('data-wysee-inline', 'link');
      a.setAttribute('data-wysee-link-index', String(linkIndex));
      linkIndex += 1;
    });
    dom.querySelectorAll('img').forEach((img) => {
      img.setAttribute('data-wysee-inline', 'image');
      img.setAttribute('data-wysee-image-index', String(imageIndex));
      const attrs = imageAttrs[imageIndex];
      if (attrs?.width) {
        img.setAttribute('data-wysee-image-width', attrs.width);
      }
      if (attrs?.align) {
        img.setAttribute('data-wysee-image-align', attrs.align);
      }
      const src = img.getAttribute('src') || '';
      const resolved = awaitResolveAsset(document.uri, src, options);
      if (resolved) {
        img.setAttribute('src', resolved);
      }
      imageIndex += 1;
    });
    wrapMisspellings(dom, block, this.deps.spellService, document.uri, options.mode);
    return dom.body.innerHTML;
  }
}

function awaitResolveAsset(base: vscode.Uri, src: string, options: RenderOptions): string | undefined {
  if (!src || /^https?:/i.test(src) || /^data:/i.test(src)) {
    return undefined;
  }
  if (options.mode === 'webview' && options.webview) {
    const absolute = vscode.Uri.file(path.resolve(path.dirname(base.fsPath), src));
    return options.webview.asWebviewUri(absolute).toString();
  }
  return src;
}

function wrapMisspellings(dom: ReturnType<typeof parseHTML>['document'], block: BlockMapEntry, spellService: SpellService, uri: vscode.Uri, mode: RenderMode): void {
  if (mode !== 'webview') {
    return;
  }
  if (block.kind === 'codeFence' || block.kind === 'mermaidFence') {
    return;
  }
  const walker = dom.createTreeWalker(dom.body, 4);
  const textNodes: any[] = [];
  let node: any;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) {
      continue;
    }
    const tag = parent.tagName?.toLowerCase();
    if (['code', 'pre', 'script', 'style'].includes(tag)) {
      continue;
    }
    textNodes.push(node);
  }
  for (const textNode of textNodes) {
    const value = String(textNode.nodeValue || '');
    const parts: string[] = [];
    let last = 0;
    const regex = /\b([A-Za-z][A-Za-z'’-]{1,})\b/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value))) {
      const word = match[1];
      parts.push(escapeHtml(value.slice(last, match.index)));
      if (spellService.isWordIgnoredOrCorrect(word, uri)) {
        parts.push(escapeHtml(word));
      } else {
        parts.push(`<span data-wysee-spell="misspelled" data-wysee-word="${escapeHtml(word)}" data-vscode-context='{"webviewSection":"wyseeSpell","wyseeSpellMisspelled":true}'>${escapeHtml(word)}</span>`);
      }
      last = match.index + word.length;
    }
    parts.push(escapeHtml(value.slice(last)));
    if (parts.join('') !== escapeHtml(value)) {
      const holder = dom.createElement('span');
      holder.innerHTML = parts.join('');
      textNode.parentNode?.replaceChild(holder, textNode);
    }
  }
}

export function preprocessMath(text: string): string {
  // Protect code blocks and inline code from math processing.
  // Replace them with placeholders, run math regexes, then restore.
  const placeholders: string[] = [];
  function stash(match: string): string {
    placeholders.push(match);
    return `\x00MATHGUARD${placeholders.length - 1}\x00`;
  }

  // 1. Stash fenced code blocks (``` or ~~~)
  text = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, stash);
  // 2. Stash inline code (backtick runs of any length)
  text = text.replace(/(`+)(?!\s*$)([\s\S]*?[^`])\1(?!`)/g, stash);
  // 3. Stash indented code blocks (4-space or tab indented lines)
  text = text.replace(/^(?: {4}|\t).+(\n(?: {4}|\t).+)*/gm, stash);

  // Block math: $$...$$  (must be on its own line or spanning lines)
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, body: string) => {
    const encoded = escapeHtml(body.trim());
    return `<div class="wysee-math" data-wysee-math-display="block" data-wysee-math-source="${encoded}">${encoded}</div>`;
  });
  // Inline math: $...$  (no newlines inside, no space after opening $ or before closing $)
  text = text.replace(/(?<!\$)\$(?!\$)(\S(?:[^\n$]*?\S)?)\$(?!\$)/g, (_match, body: string) => {
    const encoded = escapeHtml(body);
    return `<span class="wysee-math" data-wysee-math-display="inline" data-wysee-math-source="${encoded}">${encoded}</span>`;
  });

  // Restore stashed code
  text = text.replace(/\x00MATHGUARD(\d+)\x00/g, (_m, idx) => placeholders[Number(idx)]);
  return text;
}
// ── Custom Footnote System ──────────────────────────────────────

export interface FootnoteEntry {
  label: string;
  ordinal: number;
  text: string;
  firstDefinitionLine: number;
}

/**
 * Build a footnote registry from all footnoteDefinition blocks.
 * Rules:
 * - Only numeric labels (1, 2, ...) OR alpha labels (a, b, ...) are accepted, not mixed.
 * - First definition wins for duplicate labels.
 * - Ordinals assigned in order of first appearance.
 */
export function buildFootnoteRegistry(blockMap: BlockMapEntry[]): Map<string, FootnoteEntry> {
  const defs = blockMap.filter((b) => b.kind === 'footnoteDefinition');
  if (defs.length === 0) return new Map();

  const registry = new Map<string, FootnoteEntry>();
  let ordinal = 0;

  // Detect label type from first definition
  const firstLabel = defs[0]?.raw.match(/^\[\^([^\]]+)\]:/)?.[1] ?? '';
  const isNumeric = /^\d+$/.test(firstLabel);
  const isAlpha = /^[a-zA-Z]$/.test(firstLabel);

  for (const block of defs) {
    const match = block.raw.match(/^\[\^([^\]]+)\]:\s*([\s\S]*)/);
    if (!match) continue;
    const label = match[1];
    // Enforce consistent label type: accept only the detected type
    if (isNumeric && !/^\d+$/.test(label)) continue;
    if (isAlpha && !/^[a-zA-Z]$/.test(label)) continue;
    if (!isNumeric && !isAlpha) continue; // reject mixed/other labels

    if (registry.has(label)) continue; // first definition wins
    ordinal += 1;
    // Text: first line after the label, plus any continuation lines (indented)
    const textLines = match[2].trim().split(/\r?\n/);
    const text = textLines.map((line, i) => i === 0 ? line : line.replace(/^\s{2,}/, '')).join(' ').trim();
    registry.set(label, { label, ordinal, text, firstDefinitionLine: block.startLine });
  }

  return registry;
}

/**
 * Replace `[^N]` references in rendered HTML with superscript links.
 * Only replaces references that exist in the registry.
 */
export function resolveFootnoteReferences(html: string, registry: Map<string, FootnoteEntry>): string {
  if (registry.size === 0) return html;
  // Protect <code> and <pre> content from footnote matching
  const codeGuards: string[] = [];
  let guarded = html.replace(/<(code|pre)[^>]*>[\s\S]*?<\/\1>/gi, (match) => {
    codeGuards.push(match);
    return `\x00FNGUARD${codeGuards.length - 1}\x00`;
  });
  // Match literal [^label] in the HTML (it will appear as text since markdown-it didn't process it)
  guarded = guarded.replace(/\[\^([^\]]+)\]/g, (_all, label: string) => {
    const entry = registry.get(label);
    if (!entry) return _all; // leave unknown refs as-is
    return `<sup class="wysee-footnote-ref"><a href="#wysee-fn-${escapeHtml(label)}" id="wysee-fnref-${escapeHtml(label)}" title="${escapeHtml(entry.text)}">${entry.ordinal}</a></sup>`;
  });
  // Restore code content
  return guarded.replace(/\x00FNGUARD(\d+)\x00/g, (_, i) => codeGuards[Number(i)]);
}

/**
 * Render the footnotes section: HR + bold "Footnotes" + OL.
 */
export function renderFootnotesSection(registry: Map<string, FootnoteEntry>): string {
  const entries = [...registry.values()].sort((a, b) => a.ordinal - b.ordinal);
  const items = entries.map((entry) =>
    `<li id="wysee-fn-${escapeHtml(entry.label)}" value="${entry.ordinal}">${escapeHtml(entry.text)} <a href="#wysee-fnref-${escapeHtml(entry.label)}" class="wysee-footnote-backref" title="Back to reference">\u21A9</a></li>`
  ).join('\n');
  return `<hr />\n<p><strong>Footnotes</strong></p>\n<ol class="wysee-footnotes-list">\n${items}\n</ol>`;
}

/**
 * Build a footnote registry from raw markdown text (for preview).
 * Extracts [^label]: definition lines and builds a registry.
 */
export function buildFootnoteRegistryFromText(text: string): Map<string, FootnoteEntry> {
  const registry = new Map<string, FootnoteEntry>();
  const regex = /^\[\^([^\]]+)\]:\s*(.*)/gm;
  let match: RegExpExecArray | null;
  let ordinal = 0;
  let firstLabel = '';

  // First pass: detect label type
  const firstMatch = /^\[\^([^\]]+)\]:/m.exec(text);
  if (firstMatch) {
    firstLabel = firstMatch[1];
  }
  const isNumeric = /^\d+$/.test(firstLabel);
  const isAlpha = /^[a-zA-Z]$/.test(firstLabel);
  if (!isNumeric && !isAlpha && firstLabel) return registry;

  while ((match = regex.exec(text))) {
    const label = match[1];
    if (isNumeric && !/^\d+$/.test(label)) continue;
    if (isAlpha && !/^[a-zA-Z]$/.test(label)) continue;
    if (registry.has(label)) continue;
    ordinal += 1;
    registry.set(label, { label, ordinal, text: match[2].trim(), firstDefinitionLine: -1 });
  }
  return registry;
}
