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
 * Phase 1 tests: hunk context capture, serializers, and integration.
 */

import * as assert from 'assert';
import {
  HunkContextNode,
  CONTEXT_SCHEMA_VERSION,
} from '../src/export/approvalMatrix/context/contextTypes';
import {
  serializeHeadingPath,
  serializeBreadcrumbDisplay,
  serializeFullMarkdownContext,
  serializeContextJson,
} from '../src/export/approvalMatrix/context/markdownContextSerializer';
import { captureHunkContext } from '../src/export/approvalMatrix/context/contextCapture';
import { RenderViewModel, BlockMapEntry, DiffViewPresentation } from '../src/types';

// ── Test helpers ──────────────────────────────────────────────────

function makeBlockMapEntry(overrides: Partial<BlockMapEntry> & { blockId: string; raw: string }): BlockMapEntry {
  return {
    uri: 'file:///test.md',
    version: 1,
    kind: 'paragraph',
    startLine: 0,
    endLine: 0,
    startOffset: 0,
    endOffset: 0,
    ordinal: 0,
    ...overrides,
  };
}

function makeEmptyModel(): RenderViewModel {
  return {
    uri: 'file:///test.md',
    version: 1,
    title: 'test',
    html: '',
    themeCss: '',
    previewCss: '',
    pageCss: '',
    blocks: {},
    blockMap: [],
    activeThemeId: '',
    activePageProfileId: '',
    editable: false,
    commitOnBlur: false,
    trusted: true,
    copyMode: 'plainText',
    syntaxCss: '',
  };
}

// ── Serializer tests ──────────────────────────────────────────────

describe('serializeHeadingPath', () => {
  it('returns empty for no nodes', () => {
    assert.strictEqual(serializeHeadingPath([]), '');
  });

  it('returns empty when no heading nodes exist', () => {
    const nodes: HunkContextNode[] = [
      { role: 'tableHeader', relation: 'framing', markdown: '| Col A | Col B |' },
    ];
    assert.strictEqual(serializeHeadingPath(nodes), '');
  });

  it('preserves heading markers', () => {
    const nodes: HunkContextNode[] = [
      { role: 'heading', relation: 'ancestor', markdown: '# Top Level', depth: 1 },
      { role: 'heading', relation: 'ancestor', markdown: '## Sub Section', depth: 2 },
    ];
    assert.strictEqual(serializeHeadingPath(nodes), '# Top Level > ## Sub Section');
  });

  it('filters out non-ancestor headings', () => {
    const nodes: HunkContextNode[] = [
      { role: 'heading', relation: 'ancestor', markdown: '# Title', depth: 1 },
      { role: 'heading', relation: 'siblingHint', markdown: '## Sibling', depth: 2 },
    ];
    assert.strictEqual(serializeHeadingPath(nodes), '# Title');
  });
});

describe('serializeBreadcrumbDisplay', () => {
  it('returns empty for no nodes and no docPath', () => {
    assert.strictEqual(serializeBreadcrumbDisplay({ nodes: [] }), '');
  });

  it('returns docPath when no nodes', () => {
    assert.strictEqual(
      serializeBreadcrumbDisplay({ docPath: 'docs/api.md', nodes: [] }),
      'docs/api.md',
    );
  });

  it('includes heading path', () => {
    const nodes: HunkContextNode[] = [
      { role: 'heading', relation: 'ancestor', markdown: '## Auth', depth: 2 },
    ];
    const result = serializeBreadcrumbDisplay({ docPath: 'docs/api.md', nodes });
    assert.strictEqual(result, 'docs/api.md :: ## Auth');
  });

  it('appends table framing suffix', () => {
    const nodes: HunkContextNode[] = [
      { role: 'heading', relation: 'ancestor', markdown: '## Endpoints', depth: 2 },
      { role: 'tableHeader', relation: 'framing', markdown: '| Method | Path |' },
    ];
    const result = serializeBreadcrumbDisplay({ nodes });
    assert.strictEqual(result, '## Endpoints (table)');
  });

  it('appends code context suffix', () => {
    const nodes: HunkContextNode[] = [
      { role: 'heading', relation: 'ancestor', markdown: '## Examples', depth: 2 },
      { role: 'codeContext', relation: 'framing', markdown: '```python', meta: { language: 'python' } },
    ];
    const result = serializeBreadcrumbDisplay({ nodes });
    assert.strictEqual(result, '## Examples (python code)');
  });

  it('truncates at maxLength', () => {
    const nodes: HunkContextNode[] = [
      { role: 'heading', relation: 'ancestor', markdown: '## ' + 'A'.repeat(200), depth: 2 },
    ];
    const result = serializeBreadcrumbDisplay({ nodes, maxLength: 30 });
    assert.ok(result.length <= 30);
    assert.ok(result.endsWith('\u2026'));
  });
});

describe('serializeFullMarkdownContext', () => {
  it('returns empty for no nodes', () => {
    assert.strictEqual(serializeFullMarkdownContext([]), '');
  });

  it('separates ancestor and framing sections', () => {
    const nodes: HunkContextNode[] = [
      { role: 'heading', relation: 'ancestor', markdown: '# API', depth: 1 },
      { role: 'tableHeader', relation: 'framing', markdown: '| Name | Type |' },
    ];
    const result = serializeFullMarkdownContext(nodes);
    assert.ok(result.includes('Heading ancestry:'));
    assert.ok(result.includes('  # API'));
    assert.ok(result.includes('Local framing:'));
    assert.ok(result.includes('[Table header] | Name | Type |'));
  });

  it('does not label framing nodes as headings', () => {
    const nodes: HunkContextNode[] = [
      { role: 'tableHeader', relation: 'framing', markdown: '| Col |' },
    ];
    const result = serializeFullMarkdownContext(nodes);
    assert.ok(!result.includes('Heading ancestry:'));
    assert.ok(result.includes('Local framing:'));
  });
});

describe('serializeContextJson', () => {
  it('produces stable JSON', () => {
    const nodes: HunkContextNode[] = [
      { role: 'heading', relation: 'ancestor', markdown: '## Auth', depth: 2 },
    ];
    const json = serializeContextJson(nodes);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].role, 'heading');
    assert.strictEqual(parsed[0].relation, 'ancestor');
    assert.strictEqual(parsed[0].markdown, '## Auth');
    assert.strictEqual(parsed[0].depth, 2);
  });

  it('omits undefined optional fields', () => {
    const nodes: HunkContextNode[] = [
      { role: 'leadIn', relation: 'framing', markdown: 'Parameters:' },
    ];
    const json = serializeContextJson(nodes);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed[0].side, undefined);
    assert.strictEqual(parsed[0].depth, undefined);
  });
});

// ── Context capture tests ─────────────────────────────────────────

describe('captureHunkContext', () => {
  it('captures heading-only context', () => {
    const currentModel = makeEmptyModel();
    currentModel.blockMap = [
      makeBlockMapEntry({ blockId: 'h1', raw: '# API Reference', kind: 'heading', startLine: 0, endLine: 0 }),
      makeBlockMapEntry({ blockId: 'h2', raw: '## Authentication', kind: 'heading', startLine: 2, endLine: 2 }),
      makeBlockMapEntry({ blockId: 'p1', raw: 'Use an API key.', kind: 'paragraph', startLine: 4, endLine: 4 }),
    ];
    currentModel.diff = {
      mode: 'diff', side: 'modified', blocks: {
        'p1': { state: 'modified', groupId: 'g1', counterpartBlockId: 'p1-old' },
      },
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 1, total: 1 },
    };

    const baseModel = makeEmptyModel();
    baseModel.blockMap = [
      makeBlockMapEntry({ blockId: 'p1-old', raw: 'Use a static key.', kind: 'paragraph', startLine: 4, endLine: 4 }),
    ];
    baseModel.diff = {
      mode: 'diff', side: 'original', blocks: {},
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const result = captureHunkContext({
      groupId: 'g1', hunkKind: 'modified', baseModel, currentModel,
    });

    assert.strictEqual(result.bundle.schemaVersion, CONTEXT_SCHEMA_VERSION);
    assert.ok(result.bundle.headingPathMarkdown.includes('# API Reference'));
    assert.ok(result.bundle.headingPathMarkdown.includes('## Authentication'));
    assert.strictEqual(result.newBlockIds.length, 1);
    assert.strictEqual(result.previousBlockIds.length, 1);
  });

  it('captures framing-only context (table)', () => {
    const currentModel = makeEmptyModel();
    currentModel.blockMap = [
      makeBlockMapEntry({
        blockId: 't1', raw: '| Name | Type |\n|---|---|\n| id | string |',
        kind: 'table', startLine: 0, endLine: 2,
      }),
    ];
    currentModel.diff = {
      mode: 'diff', side: 'modified', blocks: {
        't1': { state: 'modified', groupId: 'g1' },
      },
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 1, total: 1 },
    };

    const baseModel = makeEmptyModel();
    baseModel.diff = {
      mode: 'diff', side: 'original', blocks: {},
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const result = captureHunkContext({
      groupId: 'g1', hunkKind: 'modified', baseModel, currentModel,
    });

    assert.strictEqual(result.bundle.headingPathMarkdown, '');
    const tableNode = result.bundle.nodes.find(n => n.role === 'tableHeader');
    assert.ok(tableNode, 'should have tableHeader node');
    assert.strictEqual(tableNode!.relation, 'framing');
    assert.ok(tableNode!.markdown.includes('| Name | Type |'));
  });

  it('captures mixed heading + framing context', () => {
    const currentModel = makeEmptyModel();
    currentModel.blockMap = [
      makeBlockMapEntry({ blockId: 'h1', raw: '# API', kind: 'heading', startLine: 0, endLine: 0 }),
      makeBlockMapEntry({ blockId: 'h2', raw: '## Endpoints', kind: 'heading', startLine: 2, endLine: 2 }),
      makeBlockMapEntry({
        blockId: 't1', raw: '| Method | Path |\n|---|---|\n| GET | /users |',
        kind: 'table', startLine: 4, endLine: 6,
      }),
    ];
    currentModel.diff = {
      mode: 'diff', side: 'modified', blocks: {
        't1': { state: 'added', groupId: 'g1' },
      },
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 1, deleted: 0, modified: 0, total: 1 },
    };

    const baseModel = makeEmptyModel();
    baseModel.diff = {
      mode: 'diff', side: 'original', blocks: {},
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const result = captureHunkContext({
      groupId: 'g1', hunkKind: 'added', baseModel, currentModel,
    });

    assert.ok(result.bundle.headingPathMarkdown.includes('# API'));
    assert.ok(result.bundle.headingPathMarkdown.includes('## Endpoints'));
    const tableNode = result.bundle.nodes.find(n => n.role === 'tableHeader');
    assert.ok(tableNode);
    assert.ok(result.bundle.breadcrumbDisplay.includes('(table)'));
  });

  it('returns empty context for no blocks', () => {
    const currentModel = makeEmptyModel();
    currentModel.diff = {
      mode: 'diff', side: 'modified', blocks: {},
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const baseModel = makeEmptyModel();
    baseModel.diff = {
      mode: 'diff', side: 'original', blocks: {},
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const result = captureHunkContext({
      groupId: 'g-missing', hunkKind: 'modified', baseModel, currentModel,
    });

    assert.strictEqual(result.bundle.headingPathMarkdown, '');
    assert.strictEqual(result.bundle.nodes.length, 0);
    assert.strictEqual(result.newBlockIds.length, 0);
    assert.strictEqual(result.previousBlockIds.length, 0);
  });

  it('de-duplicates identical nodes', () => {
    const currentModel = makeEmptyModel();
    // Two blocks in the same group under the same heading — heading captured once
    currentModel.blockMap = [
      makeBlockMapEntry({ blockId: 'h1', raw: '## Section', kind: 'heading', startLine: 0, endLine: 0 }),
      makeBlockMapEntry({ blockId: 'p1', raw: 'First paragraph.', kind: 'paragraph', startLine: 2, endLine: 2 }),
      makeBlockMapEntry({ blockId: 'p2', raw: 'Second paragraph.', kind: 'paragraph', startLine: 3, endLine: 3 }),
    ];
    currentModel.diff = {
      mode: 'diff', side: 'modified', blocks: {
        'p1': { state: 'added', groupId: 'g1' },
        'p2': { state: 'added', groupId: 'g1' },
      },
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 2, deleted: 0, modified: 0, total: 2 },
    };

    const baseModel = makeEmptyModel();
    baseModel.diff = {
      mode: 'diff', side: 'original', blocks: {},
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const result = captureHunkContext({
      groupId: 'g1', hunkKind: 'added', baseModel, currentModel,
    });

    const headingNodes = result.bundle.nodes.filter(n => n.role === 'heading');
    assert.strictEqual(headingNodes.length, 1, 'heading should appear once, not duplicated');
  });

  it('captures code fence context', () => {
    const currentModel = makeEmptyModel();
    currentModel.blockMap = [
      makeBlockMapEntry({
        blockId: 'c1', raw: '```python\ndef hello():\n    pass\n```',
        kind: 'codeFence', startLine: 0, endLine: 3,
      }),
    ];
    currentModel.diff = {
      mode: 'diff', side: 'modified', blocks: {
        'c1': { state: 'modified', groupId: 'g1' },
      },
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 1, total: 1 },
    };

    const baseModel = makeEmptyModel();
    baseModel.diff = {
      mode: 'diff', side: 'original', blocks: {},
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const result = captureHunkContext({
      groupId: 'g1', hunkKind: 'modified', baseModel, currentModel,
    });

    const codeNode = result.bundle.nodes.find(n => n.role === 'codeContext');
    assert.ok(codeNode);
    assert.strictEqual(codeNode!.meta?.language, 'python');
  });

  it('captures line spans correctly', () => {
    const currentModel = makeEmptyModel();
    currentModel.blockMap = [
      makeBlockMapEntry({ blockId: 'p1', raw: 'New text.', kind: 'paragraph', startLine: 10, endLine: 12 }),
    ];
    currentModel.diff = {
      mode: 'diff', side: 'modified', blocks: {
        'p1': { state: 'added', groupId: 'g1' },
      },
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 1, deleted: 0, modified: 0, total: 1 },
    };

    const baseModel = makeEmptyModel();
    baseModel.diff = {
      mode: 'diff', side: 'original', blocks: {},
      placeholders: [], deletionMarkers: [], hunks: [], unchangedRuns: [],
      summary: { added: 0, deleted: 0, modified: 0, total: 0 },
    };

    const result = captureHunkContext({
      groupId: 'g1', hunkKind: 'added', baseModel, currentModel,
    });

    assert.strictEqual(result.newLineSpans.length, 1);
    assert.strictEqual(result.newLineSpans[0].startLine, 10);
    assert.strictEqual(result.newLineSpans[0].endLine, 12);
    assert.strictEqual(result.previousLineSpans.length, 0);
  });
});
