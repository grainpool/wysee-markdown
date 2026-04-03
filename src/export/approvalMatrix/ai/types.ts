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
 * AI Summary Types — Phase 2 (Context Overhaul)
 *
 * Configuration lives in .wysee/ai-config.yaml in the workspace root.
 * Secrets referenced as ${{ secrets.KEY_NAME }} resolve from VS Code SecretStorage.
 */

import { SelectedRevisionContext, HunkGitContext } from '../types';

// ── YAML config model ──────────────────────────────────────────────

export interface AiConfig {
  models: AiModelEntry[];
  activeModel: string;
  context: AiContextConfig;
  prompting: AiPromptingConfig;
  output: AiOutputConfig;
}

export interface AiModelEntry {
  name: string;
  provider: string;
  model: string;
  endpoint: string;
  auth: 'none' | 'bearer' | 'custom-header';
  apiKey?: string;
  authHeader?: string;
  options?: AiModelOptions;
  requestBody?: Record<string, unknown>;
  chatPath?: string;
  requestScheduling?: { mode: 'sequential' | 'parallel'; maxConcurrent?: number };
}

export interface AiModelOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  maxRetries?: number;
  retryBackoff?: number;
  concurrency?: number;
}

export interface AiContextConfig {
  sectionContext: { mode: 'off' | 'headingOnly' | 'fullMarkdown' };
  includeHeadingOutline: boolean;
  headingOutlineDepth: number;
  outlinePath: string;
  outline: string;
  selectedRevisionMessages: boolean;
  selectedRevisionTags: boolean;
  hunkCommitProvenance: boolean;
  hunkCommitLimit: number;
  hunkCommitOrder: 'oldest-first';
  customFields: Record<string, string>;
  // Legacy compatibility
  includeManifest: boolean;
  manifestPath: string;
  // Legacy shims (accepted during normalization, mapped to sectionContext)
  includeSectionPath?: boolean;
  includeDiffSourceLabels?: boolean;
  allowReducedContext?: boolean;
}

export interface AiPromptingConfig {
  template: string;
  preamble: string;
  postamble: string;
  userAppendix: string;
}

export interface AiOutputConfig {
  blankOnFailure: boolean;
}

export const DEFAULT_CONFIG: AiConfig = {
  models: [],
  activeModel: '',
  context: {
    sectionContext: { mode: 'fullMarkdown' },
    includeHeadingOutline: false,
    headingOutlineDepth: 2,
    outlinePath: '',
    outline: '',
    selectedRevisionMessages: true,
    selectedRevisionTags: true,
    hunkCommitProvenance: true,
    hunkCommitLimit: 10,
    hunkCommitOrder: 'oldest-first',
    customFields: {},
    includeManifest: true,
    manifestPath: '',
  },
  prompting: {
    template: 'default-review-summary',
    preamble: '',
    postamble: '',
    userAppendix: '',
  },
  output: {
    blankOnFailure: true,
  },
};

// ── System templates ───────────────────────────────────────────────

export const SYSTEM_TEMPLATES: Record<string, { label: string; version: string; text: string }> = {
  'default-review-summary': {
    label: 'Default review summary',
    version: '2.0.0',
    text: 'You are a technical documentation reviewer. For each changed region, produce a concise, reviewer-facing summary describing what changed and why it matters. Be factual and precise. Do not speculate beyond what the diff shows.',
  },
  'release-notes-review': {
    label: 'Release notes review',
    version: '2.0.0',
    text: 'You are summarizing documentation changes for a release review. Frame each change in terms of user-visible impact. Use language appropriate for release notes and stakeholder review.',
  },
  'compliance-review': {
    label: 'Compliance review',
    version: '2.0.0',
    text: 'You are reviewing documentation changes with a compliance and risk lens. Flag any changes to policy language, regulatory references, data handling descriptions, or security-relevant instructions. Be conservative in your assessments.',
  },
  'api-doc-review': {
    label: 'API documentation review',
    version: '2.0.0',
    text: 'You are reviewing API documentation changes. Focus on behavior changes, naming conventions, request/response contract modifications, breaking changes, and deprecation language. Be precise about what changed in the API surface.',
  },
};

// ── Version constants ─────────────────────────────────────────────

export const PROMPT_TEMPLATE_VERSION = '2.0.0';
export const CONTEXT_SCHEMA_VERSION = '2.0.0';
export const RESPONSE_CONTRACT_VERSION = '2.0.0';
export const GIT_CONTEXT_VERSION = '1.0.0';

// Legacy aliases
export const MANIFEST_SCHEMA_VERSION = '1.0.0';
export const EXTRACTION_PIPELINE_VERSION = '2.0.0';

// ── Structured output ──────────────────────────────────────────────

export const STRUCTURED_OUTPUT_INSTRUCTIONS = `You must respond with a JSON object containing these fields:
- "summary": string (1–3 factual sentences describing what changed)
- "user_visible": boolean (true if this change affects end users, false if internal-only)
- "context_limited": boolean (true if you lacked sufficient context to summarize confidently)
- "reviewer_flags": array of strings (items needing reviewer attention, empty array if none)`;

// ── Response contracts ────────────────────────────────────────────

export interface StructuredSummaryResult {
  summary: string;
  user_visible?: boolean;
  context_limited?: boolean;
  reviewer_flags?: string[];
}

export interface NormalizedSummaryResult {
  summary: string;
  user_visible: boolean;
  context_limited: boolean;
  reviewer_flags: string[];
}

// ── Request contract ──────────────────────────────────────────────

export interface AiSummaryRequest {
  hunkId: string;
  hunkIndex: number;
  docPath: string;
  changeKind: string;
  headingPathMarkdown: string;
  breadcrumbDisplay: string;
  fullMarkdownContext: string;
  previousExcerptMarkdown: string;
  newExcerptMarkdown: string;
  headingOutline?: string;
  selectedRevisionContext?: SelectedRevisionContext;
  hunkGitContext?: HunkGitContext;
  customFields?: Record<string, string>;
  manifestContext?: ManifestContext;
}

export interface ManifestContext {
  repo_name?: string;
  repo_purpose?: string;
  product_domain?: string;
  documentation_taxonomy?: string;
  glossary_hints?: string[];
  summary_style_guidance?: string;
  doc?: {
    path?: string; title?: string; short_description?: string;
    doc_type?: string; audience?: string; product_area?: string;
    parent_navigation_path?: string; related_docs?: string[];
    tags?: string[]; review_sensitivity?: string; canonical_purpose?: string;
  };
}

// ── Cache ──────────────────────────────────────────────────────────

export interface CacheKey {
  endpoint: string;
  model: string;
  promptTemplateVersion: string;
  contextSchemaVersion: string;
  responseContractVersion: string;
  gitContextVersion: string;
  contextHash: string;
  excerptHash: string;
  selectedRevisionHash: string;
  hunkProvenanceHash: string;
  promptShapingHash: string;
}

// ── Summary result ─────────────────────────────────────────────────

export interface HunkSummaryResult {
  hunkIndex: number;
  summaryText: string;
  normalized: NormalizedSummaryResult | null;
  fromCache: boolean;
  error?: string;
}
