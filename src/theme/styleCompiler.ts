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

import { PageProfile, ThemeProfile } from '../types';
import { sanitizeStyleDeclarations } from './sanitizeStyleDeclarations';

const selectorMap: Record<string, string[]> = {
  body: ['body', '#wysee-root'],
  p: ['.wysee-block p'],
  h1: ['.wysee-block h1'],
  h2: ['.wysee-block h2'],
  h3: ['.wysee-block h3'],
  h4: ['.wysee-block h4'],
  h5: ['.wysee-block h5'],
  h6: ['.wysee-block h6'],
  ul: ['.wysee-block ul'],
  ol: ['.wysee-block ol'],
  li: ['.wysee-block li'],
  blockquote: ['.wysee-block blockquote'],
  hr: ['.wysee-block hr'],
  table: ['.wysee-block table'],
  thead: ['.wysee-block thead'],
  tbody: ['.wysee-block tbody'],
  th: ['.wysee-block th'],
  td: ['.wysee-block td'],
  tableHeaderRow: ['.wysee-block tr:first-child'],
  tableOddRow: ['.wysee-block tbody tr:nth-child(odd)'],
  tableEvenRow: ['.wysee-block tbody tr:nth-child(even)'],
  tableOddColumnCell: ['.wysee-block tr > *:nth-child(odd)'],
  tableEvenColumnCell: ['.wysee-block tr > *:nth-child(even)'],
  codeInline: ['.wysee-block code:not(pre code)'],
  codeBlock: ['.wysee-block pre code'],
  pre: ['.wysee-block pre'],
  img: ['.wysee-block img'],
  a: ['.wysee-block a'],
  taskCheckbox: ['.wysee-block input[type="checkbox"]'],
  mermaid: ['.wysee-block .wysee-mermaid'],
};

export function compileThemeToPreviewCss(theme: ThemeProfile): string {
  return compile(theme, 'preview');
}

export function compileThemeToPrintCss(theme: ThemeProfile, pageProfile: PageProfile): string {
  return `${compile(theme, 'print')}\n${compilePageProfileCss(pageProfile)}`;
}

function compile(theme: ThemeProfile, mode: 'preview' | 'print'): string {
  const lines: string[] = [];
  const source = theme.selectorStyles ?? {};
  const extras = mode === 'preview' ? theme.previewOnlyStyles : theme.printOnlyStyles;
  for (const [target, selectors] of Object.entries(selectorMap)) {
    const rules = [source[target], extras?.[target]].filter(Boolean).map((value) => sanitizeStyleDeclarations(String(value))).filter(Boolean);
    if (rules.length === 0) {
      continue;
    }
    lines.push(`${selectors.join(', ')} { ${rules.join('; ')} }`);
  }
  lines.push(`.wysee-image.align-center { display:block; margin-left:auto; margin-right:auto; }`);
  lines.push(`.wysee-image.align-right { display:block; margin-left:auto; }`);
  lines.push(`.wysee-block table { border-collapse: collapse; width: 100%; }`);
  lines.push(`.wysee-block th, .wysee-block td { border: 1px solid rgba(127,127,127,.35); padding: .35rem .5rem; }`);
  lines.push(`.wysee-directive-hint { font-size: .85rem; opacity: .7; border: 1px dashed currentColor; padding: .25rem .5rem; }`);
  lines.push(`.wysee-mermaid-error { white-space: pre-wrap; }`);
  lines.push(`.wysee-mermaid-source { display: none !important; }`);
  return lines.join('\n');
}

export function compilePageProfileCss(profile: PageProfile): string {
  // Map format names to CSS @page size keywords
  // CSS `size` supports: a3, a4, a5, b4, b5, jis-b4, jis-b5, letter, legal, ledger
  // "Tabloid" is not a CSS keyword — map to "ledger" (same dimensions: 11in × 17in)
  const formatMap: Record<string, string> = {
    Letter: 'letter', Legal: 'legal', A4: 'a4', A5: 'a5', Tabloid: 'ledger',
  };
  const size = profile.format === 'Custom'
    ? `${profile.width ?? '8.5in'} ${profile.height ?? '11in'}`
    : formatMap[profile.format] ?? profile.format.toLowerCase();
  const orientation = profile.landscape ? 'landscape' : 'portrait';
  const css = [
    `@page { size: ${size} ${orientation}; margin: ${profile.marginTop} ${profile.marginRight} ${profile.marginBottom} ${profile.marginLeft}; }`,
  ];
  if (profile.mirrorMargins) {
    css.push(`@page :left { margin-left: ${profile.marginRight}; margin-right: ${profile.marginLeft}; }`);
    css.push(`@page :right { margin-left: ${profile.marginLeft}; margin-right: ${profile.marginRight}; }`);
  }
  const pn = (profile as any).pageNumbers;
  if (pn?.enabled) {
    const style = pn.style === 'i' ? 'lower-roman' : pn.style === 'I' ? 'upper-roman' : pn.style === 'a' ? 'lower-alpha' : pn.style === 'A' ? 'upper-alpha' : 'decimal';
    const pos = pn.position === 'left' ? 'left' : pn.position === 'center' ? 'center' : 'right';
    const startAt = pn.startAt ?? 1;
    // Firefox supports @page margin boxes natively
    css.push(`body { counter-reset: page ${startAt - 1}; }`);
    css.push(`@page { @bottom-${pos} { content: counter(page, ${style}); font-size: 10pt; color: #666; } }`);
    if (pn.suppressFirstPage) {
      css.push(`@page :first { @bottom-${pos} { content: none; } }`);
    }
    // Chromium fixed-position fallback (repeats on every printed page)
    css.push(`.wysee-page-number-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: ${pos}; font-size: 10pt; color: #666; padding: 0 .5in; pointer-events: none; z-index: 9999; }`);
    css.push(`@media screen { .wysee-page-number-footer { display: none; } }`);
    if (pn.suppressFirstPage) {
      css.push(`.wysee-suppress-first-page .wysee-page-number-footer { display: none; }`);
    }
  }
  css.push(`.wysee-page-break-before { break-before: page; page-break-before: always; }`);
  css.push(`.wysee-page-break-after { break-after: page; page-break-after: always; }`);
  css.push(`.wysee-block pre { white-space: ${profile.codeBlocks?.wrap !== false ? 'pre-wrap' : 'pre'}; overflow-wrap: anywhere; }`);
  css.push(`.wysee-block img { max-width: ${profile.images?.maxWidth ?? '100%'}; }`);
  return css.join('\n');
}
