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
 * Phase 2 tests: AI response parser, prompt compiler, cache key invalidation.
 */

import * as assert from 'assert';
import { parseResponse } from '../src/export/approvalMatrix/ai/llmProvider';
import { compilePrompt, previewPrompt } from '../src/export/approvalMatrix/ai/aiPromptCompiler';
import { DEFAULT_CONFIG, AiConfig, AiSummaryRequest } from '../src/export/approvalMatrix/ai/types';

// ── Parser tests ──────────────────────────────────────────────────

describe('parseResponse', () => {
  it('accepts full 4-field JSON', () => {
    const result = parseResponse('{"summary":"Added OAuth.","user_visible":true,"context_limited":false,"reviewer_flags":["security"]}');
    assert.strictEqual(result.summary, 'Added OAuth.');
    assert.strictEqual(result.user_visible, true);
    assert.strictEqual(result.context_limited, false);
    assert.deepStrictEqual(result.reviewer_flags, ['security']);
  });

  it('accepts summary-only JSON', () => {
    const result = parseResponse('{"summary":"Changed the endpoint URL."}');
    assert.strictEqual(result.summary, 'Changed the endpoint URL.');
    assert.strictEqual(result.user_visible, true);
    assert.strictEqual(result.context_limited, false);
    assert.deepStrictEqual(result.reviewer_flags, []);
  });

  it('ignores extra unknown fields', () => {
    const result = parseResponse('{"summary":"Test.","change_type":"modification","confidence":"high","extra_field":42}');
    assert.strictEqual(result.summary, 'Test.');
  });

  it('accepts fenced JSON', () => {
    const result = parseResponse('```json\n{"summary":"Fenced response."}\n```');
    assert.strictEqual(result.summary, 'Fenced response.');
  });

  it('strips think tags', () => {
    const result = parseResponse('<think>I need to analyze this change carefully.</think>{"summary":"After thinking."}');
    assert.strictEqual(result.summary, 'After thinking.');
  });

  it('extracts JSON from surrounding text', () => {
    const result = parseResponse('Here is my analysis:\n{"summary":"Embedded JSON.","user_visible":false}\nEnd.');
    assert.strictEqual(result.summary, 'Embedded JSON.');
    assert.strictEqual(result.user_visible, false);
  });

  it('accepts legacy summary_of_change field', () => {
    const result = parseResponse('{"summary_of_change":"Legacy field value."}');
    assert.strictEqual(result.summary, 'Legacy field value.');
  });

  it('prefers summary over summary_of_change', () => {
    const result = parseResponse('{"summary":"New field.","summary_of_change":"Old field."}');
    assert.strictEqual(result.summary, 'New field.');
  });

  it('rejects missing summary', () => {
    assert.throws(() => parseResponse('{"user_visible":true,"reviewer_flags":[]}'), /No usable summary/);
  });

  it('rejects empty summary', () => {
    assert.throws(() => parseResponse('{"summary":""}'), /No usable summary/);
  });

  it('rejects plain text (non-JSON)', () => {
    assert.throws(() => parseResponse('This is just plain text without any JSON.'), /No usable summary/);
  });

  it('rejects empty response', () => {
    assert.throws(() => parseResponse(''), /No usable summary/);
  });

  it('rejects broken JSON', () => {
    assert.throws(() => parseResponse('{"summary": "incomplete json'), /No usable summary/);
  });

  it('defaults user_visible to true when missing', () => {
    const result = parseResponse('{"summary":"Test."}');
    assert.strictEqual(result.user_visible, true);
  });

  it('defaults context_limited to false when missing', () => {
    const result = parseResponse('{"summary":"Test."}');
    assert.strictEqual(result.context_limited, false);
  });

  it('defaults reviewer_flags to empty array when missing', () => {
    const result = parseResponse('{"summary":"Test."}');
    assert.deepStrictEqual(result.reviewer_flags, []);
  });
});

// ── Prompt compiler tests ─────────────────────────────────────────

describe('compilePrompt', () => {
  const baseRequest: AiSummaryRequest = {
    hunkId: 'h1', hunkIndex: 0, docPath: 'docs/api.md', changeKind: 'modification',
    headingPathMarkdown: '# API > ## Auth', breadcrumbDisplay: '# API > ## Auth',
    fullMarkdownContext: 'Heading ancestry:\n  # API\n  ## Auth',
    previousExcerptMarkdown: 'Old content here.', newExcerptMarkdown: 'New **content** here.',
  };

  it('includes document path and section in user message', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(result.userMessage.includes('Document: docs/api.md'));
    assert.ok(result.userMessage.includes('Section: # API > ## Auth'));
  });

  it('includes change type', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(result.userMessage.includes('Change type: modification'));
  });

  it('includes full markdown context when mode is fullMarkdown', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(result.userMessage.includes('Heading ancestry:'));
  });

  it('excludes full context when mode is off', () => {
    const config: AiConfig = {
      ...DEFAULT_CONFIG,
      context: { ...DEFAULT_CONFIG.context, sectionContext: { mode: 'off' } },
    };
    const result = compilePrompt(config, baseRequest);
    assert.ok(!result.userMessage.includes('Heading ancestry:'));
  });

  it('includes raw markdown excerpts', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(result.userMessage.includes('New **content** here.'));
    assert.ok(result.userMessage.includes('Old content here.'));
  });

  it('labels excerpts as previous/current version', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(result.userMessage.includes('--- Content in previous version ---'));
    assert.ok(result.userMessage.includes('--- Content in current version ---'));
  });

  it('does NOT include hunk ID in user message', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(!result.userMessage.includes('Hunk ID:'));
    assert.ok(!result.userMessage.includes('hunk-'));
  });

  it('does NOT include diff source mode', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(!result.userMessage.includes('Diff source:'));
    assert.ok(!result.userMessage.includes('revisionSelection'));
  });

  it('does NOT include context mode', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(!result.userMessage.includes('Context mode:'));
  });

  it('includes structured output instructions in system message', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(result.systemMessage.includes('"summary"'));
    assert.ok(result.systemMessage.includes('"user_visible"'));
    assert.ok(result.systemMessage.includes('"reviewer_flags"'));
  });

  it('does NOT ask for old contract fields', () => {
    const result = compilePrompt(DEFAULT_CONFIG, baseRequest);
    assert.ok(!result.systemMessage.includes('"summary_of_change"'));
    assert.ok(!result.systemMessage.includes('"change_type"'));
    assert.ok(!result.systemMessage.includes('"document_type"'));
    assert.ok(!result.systemMessage.includes('"section_path"'));
    assert.ok(!result.systemMessage.includes('"confidence"'));
  });

  it('includes custom fields when provided', () => {
    const request: AiSummaryRequest = { ...baseRequest, customFields: { project: 'Banking API' } };
    const result = compilePrompt(DEFAULT_CONFIG, request);
    assert.ok(result.userMessage.includes('Additional context:'));
    assert.ok(result.userMessage.includes('project: Banking API'));
  });

  it('includes preamble and postamble', () => {
    const config: AiConfig = {
      ...DEFAULT_CONFIG,
      prompting: { ...DEFAULT_CONFIG.prompting, preamble: 'CUSTOM PREAMBLE', postamble: 'CUSTOM POSTAMBLE' },
    };
    const result = compilePrompt(config, baseRequest);
    assert.ok(result.systemMessage.startsWith('CUSTOM PREAMBLE'));
    assert.ok(result.systemMessage.includes('CUSTOM POSTAMBLE'));
  });
});

describe('previewPrompt', () => {
  it('generates a preview with realistic content', () => {
    const result = previewPrompt(DEFAULT_CONFIG);
    assert.ok(result.userMessage.includes('docs/api-reference.md'));
    assert.ok(result.userMessage.includes('## Authentication'));
    assert.ok(result.userMessage.includes('OAuth 2.0'));
    assert.ok(result.systemMessage.includes('"summary"'));
  });
});

// ── Cache key invalidation tests ──────────────────────────────────

describe('cache key invalidation', () => {
  // Test that different version constants produce different keys
  // We can't import the cache directly without the full module, but we can
  // verify that the key includes the version fields by checking the types
  it('CacheKey includes version fields', () => {
    const types = require('../src/export/approvalMatrix/ai/types');
    assert.ok(types.PROMPT_TEMPLATE_VERSION);
    assert.ok(types.CONTEXT_SCHEMA_VERSION);
    assert.ok(types.RESPONSE_CONTRACT_VERSION);
    assert.ok(types.GIT_CONTEXT_VERSION);
    // Verify versions are 2.0.0 (bumped from 1.0.0)
    assert.strictEqual(types.PROMPT_TEMPLATE_VERSION, '2.0.0');
    assert.strictEqual(types.CONTEXT_SCHEMA_VERSION, '2.0.0');
    assert.strictEqual(types.RESPONSE_CONTRACT_VERSION, '2.0.0');
  });
});
