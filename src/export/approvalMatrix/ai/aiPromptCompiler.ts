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
 * AiPromptCompiler — Phase 2
 *
 * Composes system + user messages from the canonical context bundle,
 * raw markdown excerpts, and optional revision/manifest context.
 * No internal noise (hunk IDs, diff source modes, context modes).
 */

import { AiConfig, AiSummaryRequest, SYSTEM_TEMPLATES, STRUCTURED_OUTPUT_INSTRUCTIONS } from './types';

export interface CompiledPrompt {
  systemMessage: string;
  userMessage: string;
}

export function compilePrompt(config: AiConfig, request: AiSummaryRequest): CompiledPrompt {
  const p = config.prompting;
  const ctx = config.context;

  // ── System message ──────────────────────────────────────────────
  const template = SYSTEM_TEMPLATES[p.template] ?? SYSTEM_TEMPLATES['default-review-summary'];
  const systemParts: string[] = [];
  if (p.preamble.trim()) systemParts.push(p.preamble.trim());
  systemParts.push(template.text);
  systemParts.push(STRUCTURED_OUTPUT_INSTRUCTIONS);
  if (p.postamble.trim()) systemParts.push(p.postamble.trim());
  const systemMessage = systemParts.join('\n\n');

  // ── User message ────────────────────────────────────────────────
  const userParts: string[] = [];

  // Document and section context
  userParts.push(`Document: ${request.docPath}`);
  if (request.headingPathMarkdown) {
    userParts.push(`Section: ${request.headingPathMarkdown}`);
  }
  userParts.push(`Change type: ${request.changeKind}`);

  // Full markdown context from the canonical bundle
  const sectionMode = ctx.sectionContext?.mode ?? 'fullMarkdown';
  if (sectionMode === 'fullMarkdown' && request.fullMarkdownContext) {
    userParts.push('');
    userParts.push(request.fullMarkdownContext);
  }

  // Selected revision context
  if (request.selectedRevisionContext) {
    const { previous, newer } = request.selectedRevisionContext;
    if (previous.status === 'resolved' && previous.hash && previous.message) {
      userParts.push(`\nPrevious commit (${previous.hash.slice(0, 7)}): "${previous.message}"`);
      if (ctx.selectedRevisionTags && previous.tags?.length) {
        userParts.push(`  Tags: ${previous.tags.join(', ')}`);
      }
    }
    if (newer.status === 'resolved' && newer.hash && newer.message) {
      userParts.push(`Current commit (${newer.hash.slice(0, 7)}): "${newer.message}"`);
      if (ctx.selectedRevisionTags && newer.tags?.length) {
        userParts.push(`  Tags: ${newer.tags.join(', ')}`);
      }
    } else if (newer.isWorkingTree) {
      userParts.push('Current version: uncommitted changes');
    }
  }

  // Hunk-level touching commits
  if (request.hunkGitContext && ctx.hunkCommitProvenance) {
    const gc = request.hunkGitContext;
    if (gc.status === 'resolved' && gc.touchingCommits.length > 0) {
      const commitLines = gc.touchingCommits.map(c =>
        `  ${c.hash.slice(0, 7)}: "${c.message}"`
      );
      userParts.push(`\nCommits touching this section (${gc.totalCount} total${gc.truncatedCount ? `, showing ${gc.touchingCommits.length}` : ''}):`);
      userParts.push(commitLines.join('\n'));
    } else if (gc.status === 'unresolved' && gc.unresolvedReason) {
      userParts.push(`\nNote: commit provenance could not be resolved — ${gc.unresolvedReason}`);
    }
  }

  // Heading outline
  if (ctx.includeHeadingOutline && request.headingOutline) {
    userParts.push(`\nDocument outline:\n${request.headingOutline}`);
  }

  // Manifest context (legacy support)
  if (request.manifestContext && ctx.includeManifest) {
    const mc = request.manifestContext;
    const mp: string[] = [];
    if (mc.repo_name) mp.push(`Repo: ${mc.repo_name}`);
    if (mc.repo_purpose) mp.push(`Purpose: ${mc.repo_purpose}`);
    if (mc.product_domain) mp.push(`Domain: ${mc.product_domain}`);
    if (mc.summary_style_guidance) mp.push(`Style guidance: ${mc.summary_style_guidance}`);
    if (mc.doc?.doc_type) mp.push(`Doc type: ${mc.doc.doc_type}`);
    if (mc.doc?.audience) mp.push(`Audience: ${mc.doc.audience}`);
    if (mc.doc?.review_sensitivity) mp.push(`Sensitivity: ${mc.doc.review_sensitivity}`);
    if (mp.length) userParts.push(`\nManifest context:\n${mp.join('\n')}`);
  }

  // Custom fields
  if (request.customFields && Object.keys(request.customFields).length) {
    const cf = Object.entries(request.customFields)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    userParts.push(`\nAdditional context:\n${cf}`);
  }

  // Raw markdown excerpts
  userParts.push(`\n--- Content in previous version ---\n${request.previousExcerptMarkdown || '(no previous content)'}`);
  userParts.push(`\n--- Content in current version ---\n${request.newExcerptMarkdown || '(no new content)'}`);

  // User appendix
  if (p.userAppendix.trim()) userParts.push(`\n${p.userAppendix.trim()}`);

  return { systemMessage, userMessage: userParts.join('\n') };
}

export function previewPrompt(config: AiConfig): CompiledPrompt {
  return compilePrompt(config, {
    hunkId: 'wysee-hunk-0',
    hunkIndex: 0,
    docPath: 'docs/api-reference.md',
    changeKind: 'modification',
    headingPathMarkdown: '# API Reference > ## Authentication',
    breadcrumbDisplay: '# API Reference > ## Authentication',
    fullMarkdownContext: 'Heading ancestry:\n  # API Reference\n  ## Authentication\n\nLocal framing:\n  [Lead-in] All requests require authentication.',
    previousExcerptMarkdown: 'Northbridge uses a static API key passed in the `X-Api-Key` header.',
    newExcerptMarkdown: 'Northbridge supports two authentication methods:\n\n1. **API Key** — pass your key in the `X-Api-Key` header\n2. **OAuth 2.0** — use a bearer token in the `Authorization` header (Pro and Enterprise tiers only)',
    customFields: { project_context: 'External-facing banking API documentation' },
  });
}
