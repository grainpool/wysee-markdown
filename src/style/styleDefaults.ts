import { StyleProfile, PrintProfile, SyntaxStyleProfile } from '../types';

// ── Document Styles ─────────────────────────────────────────────

export const MATCH_EDITOR_THEME: StyleProfile = {
  id: '__match-editor',
  name: 'Match Editor Theme',
  builtIn: true,
  baseStyles: 'font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.6; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);',
  elementStyles: {
    p: 'margin: 0 0 .9rem 0;',
    h1: 'margin: 1.2rem 0 .5rem 0; font-size: 2rem;',
    h2: 'margin: 1rem 0 .4rem 0; font-size: 1.6rem;',
    h3: 'margin: .9rem 0 .35rem 0; font-size: 1.3rem;',
    h4: 'margin: .8rem 0 .3rem 0; font-size: 1.1rem;',
    blockquote: 'border-left: 3px solid rgba(127,127,127,.4); padding-left: .75rem; margin-left: 0; opacity: .95;',
    table: 'font-size: .96rem;',
    th: 'font-weight: 600;',
    codeInline: 'font-family: var(--vscode-editor-font-family); background: rgba(127,127,127,.18); padding: .1rem .25rem; border-radius: 4px;',
    codeBlock: 'font-family: var(--vscode-editor-font-family);',
    pre: 'font-family: var(--vscode-editor-font-family); padding: .75rem; overflow-x: auto; border-radius: 6px; background: rgba(127,127,127,.12);',
    img: 'max-width: 100%;',
    a: 'text-decoration: underline;',
    mermaid: 'display: block; overflow-x: auto;',
  },
};

export const LIGHT_STYLE: StyleProfile = {
  id: '__light',
  name: 'Light',
  builtIn: true,
  baseStyles: 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif; font-size: 16px; line-height: 1.6; color: #24292e; background: #ffffff;',
  elementStyles: {
    p: 'margin: 0 0 1em 0;',
    h1: 'font-size: 2em; font-weight: 700; line-height: 1.2; margin: 0 0 .5em 0; padding-bottom: .3em; border-bottom: 1px solid #eaecef;',
    h2: 'font-size: 1.5em; font-weight: 700; line-height: 1.25; margin: 1em 0 .45em 0; padding-bottom: .25em; border-bottom: 1px solid #eaecef;',
    h3: 'font-size: 1.25em; font-weight: 600; margin: 1em 0 .4em 0;',
    h4: 'font-size: 1em; font-weight: 600; margin: 1em 0 .35em 0;',
    blockquote: 'margin: 1em 0; padding-left: 1em; border-left: 3px solid #d0d0d0; color: #555;',
    a: 'color: #0366d6; text-decoration: underline;',
    table: 'width: 100%; border-collapse: collapse; margin: 1em 0;',
    th: 'font-weight: 600; text-align: left; border-bottom: 2px solid #ddd; padding: .45em .55em;',
    td: 'border-bottom: 1px solid #eee; padding: .45em .55em;',
    tableOddRow: 'background: #f8f8f8;',
    codeInline: 'font-family: "SFMono-Regular", Consolas, monospace; font-size: .92em; background: #f6f8fa; color: #24292e; padding: .15em .35em; border-radius: 4px;',
    codeBlock: 'font-family: "SFMono-Regular", Consolas, monospace; font-size: .92em; color: #24292e;',
    pre: 'background: #f6f8fa; color: #24292e; padding: .9em; border-radius: 6px; overflow-x: auto; margin: 1em 0;',
    hr: 'border: none; border-top: 1px solid #e1e4e8; margin: 1.5em 0;',
    img: 'max-width: 100%; height: auto;',
    mermaid: 'display: block; overflow-x: auto; text-align: center;',
  },
};

export const DARK_STYLE: StyleProfile = {
  id: '__dark',
  name: 'Dark',
  builtIn: true,
  baseStyles: 'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif; font-size: 16px; line-height: 1.6; color: #c9d1d9; background: #0d1117;',
  elementStyles: {
    p: 'margin: 0 0 1em 0;',
    h1: 'font-size: 2em; font-weight: 700; line-height: 1.2; margin: 0 0 .5em 0; padding-bottom: .3em; border-bottom: 1px solid #21262d;',
    h2: 'font-size: 1.5em; font-weight: 700; line-height: 1.25; margin: 1em 0 .45em 0; padding-bottom: .25em; border-bottom: 1px solid #21262d;',
    h3: 'font-size: 1.25em; font-weight: 600; margin: 1em 0 .4em 0;',
    h4: 'font-size: 1em; font-weight: 600; margin: 1em 0 .35em 0;',
    blockquote: 'margin: 1em 0; padding-left: 1em; border-left: 3px solid #3b434b; color: #8b949e;',
    a: 'color: #58a6ff; text-decoration: underline;',
    table: 'width: 100%; border-collapse: collapse; margin: 1em 0;',
    th: 'font-weight: 600; text-align: left; border-bottom: 2px solid #30363d; padding: .45em .55em;',
    td: 'border-bottom: 1px solid #21262d; padding: .45em .55em;',
    tableOddRow: 'background: rgba(255,255,255,.04);',
    codeInline: 'font-family: "SFMono-Regular", Consolas, monospace; font-size: .92em; background: rgba(110,118,129,.25); color: #c9d1d9; padding: .15em .35em; border-radius: 4px;',
    codeBlock: 'font-family: "SFMono-Regular", Consolas, monospace; font-size: .92em; color: #c9d1d9;',
    pre: 'background: #161b22; color: #c9d1d9; padding: .9em; border-radius: 6px; overflow-x: auto; margin: 1em 0;',
    hr: 'border: none; border-top: 1px solid #21262d; margin: 1.5em 0;',
    img: 'max-width: 100%; height: auto;',
    mermaid: 'display: block; overflow-x: auto; text-align: center;',
  },
};

export const BUILTIN_STYLES: StyleProfile[] = [MATCH_EDITOR_THEME, LIGHT_STYLE, DARK_STYLE];

/** Fallback element styles — used when a user style omits a key. Color-neutral so they don't bleed into dark/editor themes. */
export const DEFAULT_ELEMENT_STYLES: Record<string, string> = {
  ...LIGHT_STYLE.elementStyles,
  // Override code entries to be color-neutral — individual themes set their own colors
  codeInline: 'font-family: "SFMono-Regular", Consolas, monospace; font-size: .92em; background: rgba(127,127,127,.15); padding: .15em .35em; border-radius: 4px;',
  codeBlock: 'font-family: "SFMono-Regular", Consolas, monospace; font-size: .92em;',
  pre: 'padding: .9em; border-radius: 6px; overflow-x: auto; margin: 1em 0; background: rgba(127,127,127,.1);',
  // Remove alternating row colors from fallback — only applied if explicitly set by a theme
  tableOddRow: '',
  tableEvenRow: '',
};
export const DEFAULT_BASE_STYLES = LIGHT_STYLE.baseStyles;

// ── Print Profiles ──────────────────────────────────────────────

export const DEFAULT_PDF: PrintProfile = {
  id: '__default-pdf',
  name: 'Default PDF',
  builtIn: true,
  format: 'Letter',
  landscape: false,
  marginTop: '0.75in',
  marginRight: '0.75in',
  marginBottom: '0.75in',
  marginLeft: '0.75in',
  codeBlocks: { wrap: true },
  images: { defaultAlign: 'center', maxWidth: '100%' },
};

export const EXAMPLE_LETTER: PrintProfile = {
  id: '__example-letter',
  name: 'Example Letter',
  builtIn: true,
  format: 'Letter',
  landscape: false,
  marginTop: '1in',
  marginRight: '1in',
  marginBottom: '1in',
  marginLeft: '1in',
  codeBlocks: { wrap: true },
  images: { defaultAlign: 'center', maxWidth: '100%' },
  pageNumbers: { enabled: true, style: 'decimal', position: 'center', startAt: 1, suppressFirstPage: false },
};

export const EXAMPLE_A4: PrintProfile = {
  id: '__example-a4',
  name: 'Example A4',
  builtIn: true,
  format: 'A4',
  landscape: false,
  marginTop: '20mm',
  marginRight: '20mm',
  marginBottom: '20mm',
  marginLeft: '20mm',
  codeBlocks: { wrap: true },
  images: { defaultAlign: 'center', maxWidth: '100%' },
  pageNumbers: { enabled: true, style: 'decimal', position: 'right', startAt: 1, suppressFirstPage: true },
};

export const BUILTIN_PRINT_PROFILES: PrintProfile[] = [DEFAULT_PDF, EXAMPLE_LETTER, EXAMPLE_A4];

/** Starter JSON shown when the user clicks "Add new style…" */
export function starterStyleJson(): string {
  return JSON.stringify({
    id: 'my-style',
    name: 'My Style',
    baseStyles: 'font-family: Georgia, serif; font-size: 16px; line-height: 1.7; color: #333; background: #fff;',
    elementStyles: {
      p: 'margin: 0 0 1em 0;',
      h1: 'font-size: 2em; font-weight: 700; margin: 0 0 .5em 0;',
      h2: 'font-size: 1.5em; font-weight: 700; margin: 1em 0 .4em 0;',
      blockquote: 'border-left: 3px solid #ccc; padding-left: 1em; color: #555;',
      a: 'color: #0366d6;',
    },
  }, null, 2);
}

/** Starter JSON shown when the user clicks "Add new print style…" */
export function starterPrintJson(): string {
  return JSON.stringify({
    id: 'my-print',
    name: 'My Print Style',
    printStyle: '__light',
    format: 'Letter',
    landscape: false,
    marginTop: '0.75in',
    marginRight: '0.75in',
    marginBottom: '0.75in',
    marginLeft: '0.75in',
    pageNumbers: {
      enabled: true,
      style: 'decimal',
      position: 'center',
      startAt: 1,
      suppressFirstPage: false,
    },
  }, null, 2);
}

/**
 * Supported element style keys with human-readable descriptions.
 * Serves as documentation and validation reference.
 */
export const ELEMENT_KEY_DOCS: Record<string, string> = {
  p: 'Paragraphs',
  h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
  h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
  ul: 'Unordered lists', ol: 'Ordered lists', li: 'List items',
  blockquote: 'Block quotes', hr: 'Horizontal rules',
  table: 'Tables', thead: 'Table head', tbody: 'Table body',
  th: 'Table header cells', td: 'Table data cells',
  tableHeaderRow: 'Table header row', tableOddRow: 'Odd table rows',
  tableEvenRow: 'Even table rows', tableOddColumnCell: 'Odd column cells',
  tableEvenColumnCell: 'Even column cells',
  codeInline: 'Inline code spans', codeBlock: 'Code inside pre blocks',
  pre: 'Code block containers', img: 'Images', a: 'Links',
  taskCheckbox: 'Task-list checkboxes', mermaid: 'Mermaid diagrams',
};

// ── Syntax Styles ──────────────────────────────────────────────

export const MATCH_EDITOR_SYNTAX: SyntaxStyleProfile = {
  id: '__match-editor-syntax',
  name: 'Match Editor Theme',
  builtIn: true,
  syntaxStyles: {
    default: {
      keyword: 'color: var(--vscode-symbolIcon-keywordForeground, #c678dd);',
      builtIn: 'color: var(--vscode-symbolIcon-keywordForeground, #c678dd);',
      string: 'color: var(--vscode-debugTokenExpression-string, #98c379);',
      number: 'color: var(--vscode-debugTokenExpression-number, #d19a66);',
      comment: 'color: var(--vscode-descriptionForeground, #5c6370); font-style: italic;',
      function: 'color: var(--vscode-symbolIcon-functionForeground, #61aeee);',
      title: 'color: var(--vscode-symbolIcon-functionForeground, #61aeee);',
      type: 'color: var(--vscode-symbolIcon-typeParameterForeground, #e5c07b);',
      variable: 'color: var(--vscode-symbolIcon-variableForeground, #e06c75);',
      attr: 'color: var(--vscode-symbolIcon-propertyForeground, #d19a66);',
      tag: 'color: var(--vscode-symbolIcon-keywordForeground, #e06c75);',
      meta: 'color: var(--vscode-descriptionForeground, #abb2bf);',
      operator: 'color: var(--vscode-symbolIcon-operatorForeground, #56b6c2);',
      punctuation: '',
      property: 'color: var(--vscode-symbolIcon-propertyForeground, #e06c75);',
      params: '',
      regexp: 'color: var(--vscode-debugTokenExpression-string, #98c379);',
      literal: 'color: var(--vscode-debugTokenExpression-number, #d19a66);',
      symbol: 'color: var(--vscode-symbolIcon-variableForeground, #61aeee);',
      subst: '',
      variableLanguage: 'color: var(--vscode-symbolIcon-keywordForeground, #e06c75);',
      variableConstant: 'color: var(--vscode-debugTokenExpression-number, #d19a66);',
      charEscape: 'color: var(--vscode-debugTokenExpression-string, #d19a66);',
      titleClass: 'color: var(--vscode-symbolIcon-typeParameterForeground, #e5c07b);',
      addition: 'color: #98c379;',
      deletion: 'color: #e06c75;',
    },
  },
};

export const LIGHT_SYNTAX: SyntaxStyleProfile = {
  id: '__light-syntax',
  name: 'Light',
  builtIn: true,
  syntaxStyles: {
    default: {
      keyword: 'color: #d73a49;',
      builtIn: 'color: #d73a49;',
      string: 'color: #032f62;',
      number: 'color: #005cc5;',
      comment: 'color: #6a737d; font-style: italic;',
      function: 'color: #6f42c1;',
      title: 'color: #6f42c1;',
      type: 'color: #005cc5;',
      variable: 'color: #e36209;',
      attr: 'color: #005cc5;',
      tag: 'color: #22863a;',
      meta: 'color: #6a737d;',
      operator: 'color: #d73a49;',
      punctuation: 'color: #24292e;',
      property: 'color: #005cc5;',
      params: 'color: #24292e;',
      regexp: 'color: #032f62;',
      literal: 'color: #005cc5;',
      symbol: 'color: #005cc5;',
      subst: 'color: #24292e;',
      variableLanguage: 'color: #d73a49;',
      variableConstant: 'color: #005cc5; font-weight: 600;',
      charEscape: 'color: #005cc5;',
      titleClass: 'color: #6f42c1; font-weight: 600;',
      addition: 'color: #22863a; background: rgba(34,134,58,.1);',
      deletion: 'color: #b31d28; background: rgba(179,29,40,.1);',
    },
  },
};

export const DARK_SYNTAX: SyntaxStyleProfile = {
  id: '__dark-syntax',
  name: 'Dark',
  builtIn: true,
  syntaxStyles: {
    default: {
      keyword: 'color: #c678dd;',
      builtIn: 'color: #c678dd;',
      string: 'color: #98c379;',
      number: 'color: #d19a66;',
      comment: 'color: #5c6370; font-style: italic;',
      function: 'color: #61aeee;',
      title: 'color: #61aeee;',
      type: 'color: #e5c07b;',
      variable: 'color: #e06c75;',
      attr: 'color: #d19a66;',
      tag: 'color: #e06c75;',
      meta: 'color: #abb2bf;',
      operator: 'color: #56b6c2;',
      punctuation: 'color: #abb2bf;',
      property: 'color: #e06c75;',
      params: 'color: #abb2bf;',
      regexp: 'color: #98c379;',
      literal: 'color: #d19a66;',
      symbol: 'color: #61aeee;',
      subst: '',
      variableLanguage: 'color: #e06c75; font-style: italic;',
      variableConstant: 'color: #d19a66; font-weight: 600;',
      charEscape: 'color: #d19a66;',
      titleClass: 'color: #e5c07b; font-weight: 600;',
      addition: 'color: #98c379;',
      deletion: 'color: #e06c75;',
    },
  },
};

export const BUILTIN_SYNTAX_STYLES: SyntaxStyleProfile[] = [MATCH_EDITOR_SYNTAX, LIGHT_SYNTAX, DARK_SYNTAX];

/** Starter JSON for new syntax styles */
export function starterSyntaxJson(): string {
  return JSON.stringify({
    id: 'my-syntax',
    name: 'My Syntax Theme',
    syntaxStyles: {
      default: {
        keyword: 'color: #c678dd;',
        string: 'color: #98c379;',
        comment: 'color: #5c6370; font-style: italic;',
        number: 'color: #d19a66;',
        function: 'color: #61aeee;',
        type: 'color: #e5c07b;',
        variable: 'color: #e06c75;',
        operator: 'color: #56b6c2;',
        punctuation: '',
        property: 'color: #e06c75;',
      },
      python: {
        keyword: 'color: #ff79c6;',
        string: 'color: #f1fa8c;',
      },
    },
  }, null, 2);
}

/** Token key docs for the style panel */
export const SYNTAX_TOKEN_DOCS: Record<string, string> = {
  keyword: 'Keywords (if, else, return, class, etc.)',
  builtIn: 'Built-in names (print, len, console, etc.)',
  type: 'Type names (int, String, boolean, etc.)',
  literal: 'Literal values (true, false, null, None)',
  string: 'String literals',
  regexp: 'Regular expressions',
  number: 'Numeric literals',
  variable: 'Variables',
  operator: 'Operators (=, +, -, ==, =>, etc.)',
  punctuation: 'Punctuation (brackets, parens, semicolons, commas)',
  property: 'Object properties and CSS properties',
  comment: 'Comments',
  doctag: 'Doc comment tags (@param, @return)',
  function: 'Function names at definition',
  title: 'Titles / class names (general)',
  titleClass: 'Class names specifically (higher specificity than title)',
  params: 'Function parameters',
  attr: 'HTML/XML attributes',
  attribute: 'CSS properties / attribute values',
  selector: 'CSS selectors (#id, .class)',
  selectorAttr: 'CSS attribute selectors ([type="text"])',
  selectorPseudo: 'CSS pseudo selectors (:hover, ::before)',
  tag: 'HTML/XML tag names',
  name: 'Names in various contexts',
  meta: 'Preprocessor / metadata',
  symbol: 'Symbols and special literals',
  bullet: 'List bullets in markup',
  link: 'Links / URLs',
  subst: 'Template literal substitutions (${...})',
  code: 'Code spans in markup',
  formula: 'Math formulas in markup',
  variableLanguage: 'Language-reserved variables (this, self, super)',
  variableConstant: 'Constants (ALL_CAPS identifiers)',
  charEscape: 'Escape sequences in strings (\\n, \\t, \\x00)',
  addition: 'Diff additions',
  deletion: 'Diff deletions',
  emphasis: 'Italic/emphasis in markup',
  strong: 'Bold/strong in markup',
};
