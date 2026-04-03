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

export interface BlockMapEntry {
  blockId: string;
  uri: string;
  version: number;
  kind: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  ordinal: number;
  raw: string;
  meta?: Record<string, unknown>;
}

export interface StyleProfile {
  id: string;
  name: string;
  builtIn?: boolean;
  syntaxStyle?: string;
  baseStyles: string;
  elementStyles: Partial<Record<StyleElementKey, string>>;
}

export type StyleElementKey =
  | 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'ul' | 'ol' | 'li' | 'blockquote' | 'hr'
  | 'table' | 'thead' | 'tbody' | 'th' | 'td'
  | 'tableHeaderRow' | 'tableOddRow' | 'tableEvenRow'
  | 'tableOddColumnCell' | 'tableEvenColumnCell'
  | 'codeInline' | 'codeBlock' | 'pre'
  | 'img' | 'a' | 'taskCheckbox' | 'mermaid';

export const STYLE_ELEMENT_KEYS: StyleElementKey[] = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'hr',
  'table', 'thead', 'tbody', 'th', 'td',
  'tableHeaderRow', 'tableOddRow', 'tableEvenRow',
  'tableOddColumnCell', 'tableEvenColumnCell',
  'codeInline', 'codeBlock', 'pre',
  'img', 'a', 'taskCheckbox', 'mermaid',
];

export interface PrintProfile {
  id: string;
  name: string;
  builtIn?: boolean;
  printStyle?: string;
  format: 'Letter' | 'Legal' | 'A4' | 'A5' | 'Tabloid' | 'Custom';
  width?: string;
  height?: string;
  landscape: boolean;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  mirrorMargins?: boolean;
  codeBlocks?: { wrap: boolean };
  images?: { defaultAlign?: 'left' | 'center' | 'right'; maxWidth?: string };
  pageNumbers?: {
    enabled: boolean;
    style?: 'decimal' | 'i' | 'I' | 'a' | 'A';
    position?: 'left' | 'center' | 'right';
    startAt?: number;
    suppressFirstPage?: boolean;
  };
}

/** @deprecated Alias kept during migration — will be removed. */
export type ThemeProfile = StyleProfile & { selectorStyles: Record<string, string>; previewOnlyStyles?: Record<string, string>; printOnlyStyles?: Record<string, string>; exportClassName?: string; pageProfileId?: string };
/** @deprecated Alias kept during migration — will be removed. */
export type PageProfile = PrintProfile;

export interface PreviewSessionState {
  sessionId: string;
  uri: string;
  documentVersion: number;
  focusedBlockId?: string;
  focusedBlockKind?: string;
  contextBlockId?: string;
  contextBlockKind?: string;
  contextWord?: string;
  hasSelection: boolean;
  selectionText?: string;
  lastContextMenuAt?: number;
  scrollTopLine?: number;
  editPanelActive?: boolean;
}

export interface SpellDiagnostic {
  word: string;
  range: vscode.Range;
  suggestions: string[];
  source: 'spell';
}

export interface SpellResult {
  diagnostics: SpellDiagnostic[];
  sessionIgnoreWords: string[];
  documentIgnoreWords: string[];
}


export interface SectionWordCount {
  heading: string;
  level: number;
  wordCount: number;
  blockId: string;
  startLine: number;
}

export interface DanglingReferenceIssue {
  id: string;
  kind: 'image' | 'link' | 'footnote' | 'reference';
  message: string;
  snippet: string;
  blockId: string;
  relativeStart: number;
  relativeEnd: number;
  line: number;
}

export interface DocumentStats {
  wordCount: number;
  readingTimeMinutes: number;
  characterCountPlainText: number;
  characterCountNoSpaces: number;
  characterCountWithMarkup: number;
  paragraphCount: number;
  tableCount: number;
  imageCount: number;
  diagramCount: number;
  codeBlockLineCount: number;
  sectionDepth: number;
  sections: SectionWordCount[];
  danglingReferenceCount: number;
  danglingIssues: DanglingReferenceIssue[];
}

export interface DiffInlineRange {
  start: number;
  end: number;
  tone: 'added' | 'removed' | 'modified';
}

export interface DiffBlockDecoration {
  state: 'unchanged' | 'modified' | 'added' | 'deleted';
  counterpartBlockId?: string;
  inlineRanges?: DiffInlineRange[];
  groupId?: string;
  groupPosition?: 'single' | 'start' | 'middle' | 'end';
}

export interface DiffPlaceholderPresentation {
  id: string;
  kind: 'added' | 'deleted';
  beforeBlockId?: string | null;
  lineCount: number;
  blockCount: number;
  groupId?: string;
}

export interface DiffDeletionMarkerPresentation {
  id: string;
  beforeBlockId?: string | null;
  lineCount: number;
  groupId?: string;
}

export interface DiffHunk {
  id: string;
  index: number;
  kind: 'added' | 'deleted' | 'modified' | 'mixed';
  /** Anchor blockId or placeholder ID on this side */
  anchorId: string;
  /** Corresponding groupId used by blocks/placeholders */
  groupId: string;
}

export interface DiffUnchangedRun {
  id: string;
  /** Block IDs in this unchanged region */
  blockIds: string[];
  /** Number of blocks */
  blockCount: number;
  /** Whether this run is collapsible (large enough) */
  collapsible: boolean;
  /** Block ID of the first block in the run */
  firstBlockId: string;
  /** Block ID of the last block in the run */
  lastBlockId: string;
}

export interface DiffViewPresentation {
  mode: 'none' | 'git' | 'diff';
  side?: 'original' | 'modified';
  comparisonLabel?: string;
  readOnly?: boolean;
  firstAnchorId?: string;
  conflict?: boolean;
  blocks: Record<string, DiffBlockDecoration>;
  placeholders: DiffPlaceholderPresentation[];
  deletionMarkers: DiffDeletionMarkerPresentation[];
  hunks: DiffHunk[];
  unchangedRuns: DiffUnchangedRun[];
  summary: {
    added: number;
    deleted: number;
    modified: number;
  };
}

export interface RenderedBlockModel {
  blockId: string;
  kind: string;
  startLine: number;
  endLine: number;
  raw: string;
  plainText: string;
  html: string;
  meta?: Record<string, unknown>;
}

export interface RenderViewModel {
  uri: string;
  version: number;
  title: string;
  html: string;
  themeCss: string;
  previewCss: string;
  pageCss: string;
  blocks: Record<string, RenderedBlockModel>;
  blockMap: BlockMapEntry[];
  activeThemeId: string;
  activePageProfileId: string;
  editable: boolean;
  commitOnBlur: boolean;
  trusted: boolean;
  copyMode: 'plainText' | 'sourceMarkdown';
  syntaxCss: string;
  stats?: DocumentStats;
  diff?: DiffViewPresentation;
}

export interface BlockEditPayload {
  blockId: string;
  documentVersion: number;
  editKind: 'text' | 'raw' | 'link' | 'image' | 'tableCell';
  value?: string;
  text?: string;
  url?: string;
  alt?: string;
  src?: string;
  width?: string;
  align?: string;
  occurrenceIndex?: number;
  row?: number;
  col?: number;
}

export interface InsertTarget {
  uri: vscode.Uri;
  selection?: vscode.Selection;
  blockId?: string;
}

export type InsertAnchor = 'before' | 'after';

export interface PrintBundleAsset {
  route: string;
  contentType: string;
  body: Buffer | string;
}

export interface PrintBundle {
  jobId: string;
  token: string;
  title: string;
  html: string;
  css: string;
  js: string;
  assets: PrintBundleAsset[];
  pageProfileId: string;
  themeId: string;
}

export interface BrowserLaunchResult {
  adapter: string;
  launched: boolean;
  detail?: string;
}

export interface WyseeErrorShape {
  code: string;
  component: 'editor' | 'render' | 'spell' | 'theme' | 'print' | 'export' | 'security' | 'context';
  message: string;
  details?: Record<string, unknown>;
  remediation?: string;
  cause?: unknown;
  sessionId?: string;
  uri?: string;
}

export interface SelfCheckReportItem {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface SelfCheckReport {
  ok: boolean;
  items: SelfCheckReportItem[];
}

// ── Syntax Style Profiles ────────────────────────────────────

export type SyntaxTokenKey =
  | 'keyword' | 'builtIn' | 'type' | 'literal'
  | 'string' | 'regexp' | 'number' | 'variable'
  | 'operator' | 'punctuation' | 'property'
  | 'comment' | 'doctag'
  | 'function' | 'title' | 'titleClass' | 'params'
  | 'attr' | 'attribute' | 'selector' | 'selectorAttr' | 'selectorPseudo'
  | 'tag' | 'name'
  | 'meta' | 'symbol' | 'bullet' | 'link'
  | 'subst' | 'code' | 'formula'
  | 'variableLanguage' | 'variableConstant' | 'charEscape'
  | 'addition' | 'deletion' | 'emphasis' | 'strong';

export const SYNTAX_TOKEN_KEYS: SyntaxTokenKey[] = [
  'keyword', 'builtIn', 'type', 'literal',
  'string', 'regexp', 'number', 'variable',
  'operator', 'punctuation', 'property',
  'comment', 'doctag',
  'function', 'title', 'titleClass', 'params',
  'attr', 'attribute', 'selector', 'selectorAttr', 'selectorPseudo',
  'tag', 'name',
  'meta', 'symbol', 'bullet', 'link',
  'subst', 'code', 'formula',
  'variableLanguage', 'variableConstant', 'charEscape',
  'addition', 'deletion', 'emphasis', 'strong',
];

export interface SyntaxLanguageStyle {
  highlight?: boolean;
  [token: string]: string | boolean | undefined;
}

export interface SyntaxStyleProfile {
  id: string;
  name: string;
  builtIn?: boolean;
  syntaxStyles: {
    default?: SyntaxLanguageStyle;
    [language: string]: SyntaxLanguageStyle | undefined;
  };
}
