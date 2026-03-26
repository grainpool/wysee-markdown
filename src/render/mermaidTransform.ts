import { escapeHtml } from '../util/strings';

export function renderMermaidBlock(source: string): string {
  const body = source.split(/\r?\n/).slice(1, -1).join('\n');
  return [
    '<div class="wysee-mermaid-block">',
    `<pre class="wysee-mermaid-source" hidden>${escapeHtml(body)}</pre>`,
    `<div class="wysee-mermaid" data-wysee-mermaid-source="${escapeHtml(body)}"></div>`,
    '</div>',
  ].join('');
}
