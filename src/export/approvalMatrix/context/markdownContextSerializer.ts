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

/**
 * MarkdownContextSerializer
 *
 * Derives all string representations from the canonical HunkContextNode[].
 * No consumer outside this module should synthesize its own breadcrumb or
 * section label.
 */

import { HunkContextNode } from './contextTypes';

/**
 * Heading-only path with markdown markers preserved.
 * Returns empty string when no heading ancestry exists.
 */
export function serializeHeadingPath(nodes: HunkContextNode[]): string {
  const headings = nodes.filter(n => n.role === 'heading' && n.relation === 'ancestor');
  if (!headings.length) return '';
  return headings.map(n => n.markdown).join(' > ');
}

/**
 * Compact single-line breadcrumb for workbook cells and card headers.
 * Prefers heading ancestry. Appends a short framing suffix only when it
 * materially disambiguates the hunk.
 */
export function serializeBreadcrumbDisplay(args: {
  docPath?: string;
  nodes: HunkContextNode[];
  maxLength?: number;
}): string {
  const { nodes, docPath, maxLength = 120 } = args;
  const headingPath = serializeHeadingPath(nodes);

  // Find the most relevant framing suffix
  let suffix = '';
  const framingNodes = nodes.filter(n => n.relation === 'framing');
  if (framingNodes.length > 0) {
    const best = framingNodes[0];
    if (best.role === 'tableHeader') {
      suffix = ' (table)';
    } else if (best.role === 'codeContext' && best.meta?.language) {
      suffix = ` (${best.meta.language} code)`;
    } else if (best.role === 'calloutTitle') {
      suffix = ` (${best.markdown})`;
    }
  }

  let result = headingPath ? headingPath + suffix : suffix.trim();

  // Prepend docPath if provided and the breadcrumb has content
  if (docPath && result) {
    result = `${docPath} :: ${result}`;
  } else if (docPath) {
    result = docPath;
  }

  // Deterministic truncation
  if (result.length > maxLength) {
    result = result.slice(0, maxLength - 1) + '\u2026';
  }

  return result;
}

/**
 * Multi-line markdown-preserving context for AI prompts and diagnostics.
 * Keeps ancestor context separate from local framing context.
 * Never serializes a table header or code label as a document heading.
 */
export function serializeFullMarkdownContext(nodes: HunkContextNode[]): string {
  if (!nodes.length) return '';

  const parts: string[] = [];

  // Ancestor section
  const ancestors = nodes.filter(n => n.relation === 'ancestor');
  if (ancestors.length) {
    parts.push('Heading ancestry:');
    for (const n of ancestors) {
      parts.push(`  ${n.markdown}`);
    }
  }

  // Framing section
  const framing = nodes.filter(n => n.relation === 'framing');
  if (framing.length) {
    if (parts.length) parts.push('');
    parts.push('Local framing:');
    for (const n of framing) {
      const label = roleLabel(n.role);
      parts.push(`  [${label}] ${n.markdown}`);
    }
  }

  // Sibling hints
  const hints = nodes.filter(n => n.relation === 'siblingHint');
  if (hints.length) {
    if (parts.length) parts.push('');
    parts.push('Related context:');
    for (const n of hints) {
      parts.push(`  ${n.markdown}`);
    }
  }

  return parts.join('\n');
}

/**
 * Stable JSON serialization for hidden workbook metadata and debugging.
 * Preserves node ordering and roles.
 */
export function serializeContextJson(nodes: HunkContextNode[]): string {
  const stripped = nodes.map(n => {
    const entry: Record<string, unknown> = {
      role: n.role,
      relation: n.relation,
      markdown: n.markdown,
    };
    if (n.side) entry.side = n.side;
    if (n.depth !== undefined) entry.depth = n.depth;
    if (n.meta) entry.meta = n.meta;
    return entry;
  });
  return JSON.stringify(stripped);
}

function roleLabel(role: string): string {
  switch (role) {
    case 'tableHeader': return 'Table header';
    case 'leadIn': return 'Lead-in';
    case 'caption': return 'Caption';
    case 'listContext': return 'List context';
    case 'codeContext': return 'Code';
    case 'calloutTitle': return 'Callout';
    case 'blockTypeLabel': return 'Label';
    case 'opaqueMeta': return 'Meta';
    default: return role;
  }
}
