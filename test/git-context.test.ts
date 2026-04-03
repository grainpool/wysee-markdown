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
 * Phase 3 tests: Git context resolution, prompt compiler Git sections,
 * provenance span selection, and metadata serialization.
 */

import * as assert from 'assert';
import { compilePrompt } from '../src/export/approvalMatrix/ai/aiPromptCompiler';
import {
  DEFAULT_CONFIG, AiConfig, AiSummaryRequest,
  SelectedRevisionContext, HunkGitContext,
} from '../src/export/approvalMatrix/ai/types';
import {
  RevisionGitContext,
} from '../src/export/approvalMatrix/types';

// ── Test helpers ──────────────────────────────────────────────────

function makeBaseRequest(overrides?: Partial<AiSummaryRequest>): AiSummaryRequest {
  return {
    hunkId: 'h1', hunkIndex: 0, docPath: 'docs/api.md', changeKind: 'modification',
    headingPathMarkdown: '## Auth', breadcrumbDisplay: '## Auth',
    fullMarkdownContext: 'Heading ancestry:\n  ## Auth',
    previousExcerptMarkdown: 'Old content.', newExcerptMarkdown: 'New content.',
    ...overrides,
  };
}

// ── Selected revision in prompt ───────────────────────────────────

describe('prompt compiler — selected revision context', () => {
  it('includes resolved commit messages for both sides', () => {
    const revCtx: SelectedRevisionContext = {
      previous: { token: 'abc1234', status: 'resolved', hash: 'abc1234567890', message: 'Initial API v2.0' },
      newer: { token: 'def5678', status: 'resolved', hash: 'def5678901234', message: 'v2.1: OAuth, alerts' },
    };
    const result = compilePrompt(DEFAULT_CONFIG, makeBaseRequest({ selectedRevisionContext: revCtx }));
    assert.ok(result.userMessage.includes('Previous commit (abc1234)'));
    assert.ok(result.userMessage.includes('Initial API v2.0'));
    assert.ok(result.userMessage.includes('Current commit (def5678)'));
    assert.ok(result.userMessage.includes('v2.1: OAuth, alerts'));
  });

  it('shows working-tree marker for uncommitted changes', () => {
    const revCtx: SelectedRevisionContext = {
      previous: { token: 'HEAD', status: 'resolved', hash: 'abc1234567890', message: 'Last commit' },
      newer: { token: 'current-changes', status: 'working-tree', isWorkingTree: true },
    };
    const result = compilePrompt(DEFAULT_CONFIG, makeBaseRequest({ selectedRevisionContext: revCtx }));
    assert.ok(result.userMessage.includes('Current version: uncommitted changes'));
    assert.ok(!result.userMessage.includes('Current commit'));
  });

  it('omits revision section when no context provided', () => {
    const result = compilePrompt(DEFAULT_CONFIG, makeBaseRequest());
    assert.ok(!result.userMessage.includes('Previous commit'));
    assert.ok(!result.userMessage.includes('Current commit'));
    assert.ok(!result.userMessage.includes('uncommitted'));
  });

  it('includes tags when configured', () => {
    const config: AiConfig = {
      ...DEFAULT_CONFIG,
      context: { ...DEFAULT_CONFIG.context, selectedRevisionTags: true },
    };
    const revCtx: SelectedRevisionContext = {
      previous: { token: 'v2.0', status: 'resolved', hash: 'abc1234567890', message: 'Release v2.0', tags: ['v2.0', 'stable'] },
      newer: { token: 'v2.1', status: 'resolved', hash: 'def5678901234', message: 'Release v2.1', tags: ['v2.1'] },
    };
    const result = compilePrompt(config, makeBaseRequest({ selectedRevisionContext: revCtx }));
    assert.ok(result.userMessage.includes('Tags: v2.0, stable'));
    assert.ok(result.userMessage.includes('Tags: v2.1'));
  });

  it('omits tags when not configured', () => {
    const config: AiConfig = {
      ...DEFAULT_CONFIG,
      context: { ...DEFAULT_CONFIG.context, selectedRevisionTags: false },
    };
    const revCtx: SelectedRevisionContext = {
      previous: { token: 'v2.0', status: 'resolved', hash: 'abc1234567890', message: 'v2.0', tags: ['v2.0'] },
      newer: { token: 'v2.1', status: 'resolved', hash: 'def5678901234', message: 'v2.1' },
    };
    const result = compilePrompt(config, makeBaseRequest({ selectedRevisionContext: revCtx }));
    assert.ok(!result.userMessage.includes('Tags:'));
  });
});

// ── Touching commits in prompt ────────────────────────────────────

describe('prompt compiler — hunk touching commits', () => {
  it('includes resolved touching commits', () => {
    const gitCtx: HunkGitContext = {
      status: 'resolved',
      touchingCommits: [
        { hash: 'aaa1111222233', message: 'Add base URLs' },
        { hash: 'bbb4444555566', message: 'Add OAuth auth method' },
      ],
      totalCount: 2,
    };
    const result = compilePrompt(DEFAULT_CONFIG, makeBaseRequest({ hunkGitContext: gitCtx }));
    assert.ok(result.userMessage.includes('Commits touching this section (2 total)'));
    assert.ok(result.userMessage.includes('aaa1111: "Add base URLs"'));
    assert.ok(result.userMessage.includes('bbb4444: "Add OAuth auth method"'));
  });

  it('shows truncation note when capped', () => {
    const gitCtx: HunkGitContext = {
      status: 'resolved',
      touchingCommits: [
        { hash: 'aaa1111222233', message: 'First' },
        { hash: 'bbb4444555566', message: 'Second' },
      ],
      totalCount: 15,
      truncatedCount: 13,
    };
    const result = compilePrompt(DEFAULT_CONFIG, makeBaseRequest({ hunkGitContext: gitCtx }));
    assert.ok(result.userMessage.includes('15 total, showing 2'));
  });

  it('shows unresolved note for failed provenance', () => {
    const gitCtx: HunkGitContext = {
      status: 'unresolved',
      touchingCommits: [],
      totalCount: 0,
      unresolvedReason: 'File was renamed during range',
    };
    const result = compilePrompt(DEFAULT_CONFIG, makeBaseRequest({ hunkGitContext: gitCtx }));
    assert.ok(result.userMessage.includes('commit provenance could not be resolved'));
    assert.ok(result.userMessage.includes('File was renamed'));
  });

  it('omits touching commits when provenance disabled', () => {
    const config: AiConfig = {
      ...DEFAULT_CONFIG,
      context: { ...DEFAULT_CONFIG.context, hunkCommitProvenance: false },
    };
    const gitCtx: HunkGitContext = {
      status: 'resolved',
      touchingCommits: [{ hash: 'aaa111', message: 'Test' }],
      totalCount: 1,
    };
    const result = compilePrompt(config, makeBaseRequest({ hunkGitContext: gitCtx }));
    assert.ok(!result.userMessage.includes('Commits touching'));
  });

  it('omits section entirely when no git context', () => {
    const result = compilePrompt(DEFAULT_CONFIG, makeBaseRequest());
    assert.ok(!result.userMessage.includes('Commits touching'));
    assert.ok(!result.userMessage.includes('provenance'));
  });
});

// ── Revision context types ────────────────────────────────────────

describe('RevisionGitContext contract', () => {
  it('working-tree has correct shape', () => {
    const ctx: RevisionGitContext = { token: 'current-changes', status: 'working-tree', isWorkingTree: true };
    assert.strictEqual(ctx.status, 'working-tree');
    assert.strictEqual(ctx.isWorkingTree, true);
    assert.strictEqual(ctx.hash, undefined);
  });

  it('resolved commit has hash and message', () => {
    const ctx: RevisionGitContext = { token: 'abc1234', status: 'resolved', hash: 'abc1234567890', message: 'Test commit' };
    assert.strictEqual(ctx.status, 'resolved');
    assert.ok(ctx.hash);
    assert.ok(ctx.message);
  });

  it('unresolved has reason', () => {
    const ctx: RevisionGitContext = { token: 'bad-ref', status: 'unresolved', unresolvedReason: 'Not a valid ref' };
    assert.strictEqual(ctx.status, 'unresolved');
    assert.ok(ctx.unresolvedReason);
    assert.strictEqual(ctx.hash, undefined);
  });

  it('not-applicable for open diff pairs', () => {
    const ctx: RevisionGitContext = { token: '', status: 'not-applicable' };
    assert.strictEqual(ctx.status, 'not-applicable');
  });
});

// ── HunkGitContext contract ───────────────────────────────────────

describe('HunkGitContext contract', () => {
  it('resolved with commits preserves ordering', () => {
    const ctx: HunkGitContext = {
      status: 'resolved',
      touchingCommits: [
        { hash: 'older111', message: 'First change' },
        { hash: 'newer222', message: 'Second change' },
      ],
      totalCount: 2,
    };
    assert.strictEqual(ctx.touchingCommits[0].hash, 'older111');
    assert.strictEqual(ctx.touchingCommits[1].hash, 'newer222');
  });

  it('truncated preserves total count', () => {
    const ctx: HunkGitContext = {
      status: 'resolved',
      touchingCommits: [{ hash: 'abc', message: 'Only shown' }],
      totalCount: 25,
      truncatedCount: 24,
    };
    assert.strictEqual(ctx.totalCount, 25);
    assert.strictEqual(ctx.truncatedCount, 24);
    assert.strictEqual(ctx.touchingCommits.length, 1);
  });

  it('unresolved does not fabricate commits', () => {
    const ctx: HunkGitContext = {
      status: 'unresolved',
      touchingCommits: [],
      totalCount: 0,
      unresolvedReason: 'git log -L failed',
    };
    assert.strictEqual(ctx.touchingCommits.length, 0);
    assert.ok(ctx.unresolvedReason);
  });
});

// ── Prompt ordering ───────────────────────────────────────────────

describe('prompt compiler — Git context ordering', () => {
  it('presents Git context before excerpts', () => {
    const revCtx: SelectedRevisionContext = {
      previous: { token: 'HEAD~1', status: 'resolved', hash: 'abc1234567890', message: 'Prev commit' },
      newer: { token: 'HEAD', status: 'resolved', hash: 'def5678901234', message: 'Current commit' },
    };
    const gitCtx: HunkGitContext = {
      status: 'resolved',
      touchingCommits: [{ hash: 'xyz999', message: 'Touch' }],
      totalCount: 1,
    };
    const result = compilePrompt(DEFAULT_CONFIG, makeBaseRequest({
      selectedRevisionContext: revCtx,
      hunkGitContext: gitCtx,
    }));

    const prevCommitIdx = result.userMessage.indexOf('Previous commit');
    const touchingIdx = result.userMessage.indexOf('Commits touching');
    const excerptIdx = result.userMessage.indexOf('--- Content in previous version ---');

    assert.ok(prevCommitIdx >= 0, 'should have previous commit');
    assert.ok(touchingIdx >= 0, 'should have touching commits');
    assert.ok(excerptIdx >= 0, 'should have excerpt');
    assert.ok(prevCommitIdx < touchingIdx, 'revision context before touching commits');
    assert.ok(touchingIdx < excerptIdx, 'touching commits before excerpts');
  });
});
