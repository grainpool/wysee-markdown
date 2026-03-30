import * as assert from 'assert';
import { buildSideBySideDiffPresentations, buildWorkingTreeDiffPresentation } from '../src/diff/blockDiff';
import { BlockMapEntry, RenderViewModel, RenderedBlockModel } from '../src/types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function block(blockId: string, kind: string, raw: string, startLine: number): RenderedBlockModel {
  return {
    blockId,
    kind,
    startLine,
    endLine: startLine + Math.max(0, raw.split(/\r?\n/).length - 1),
    raw,
    plainText: raw,
    html: `<div class="wysee-block" data-wysee-block-id="${escapeHtml(blockId)}" data-wysee-kind="${escapeHtml(kind)}">${escapeHtml(raw)}</div>`,
  };
}

function blockMapEntry(rendered: RenderedBlockModel, index: number): BlockMapEntry {
  return {
    blockId: rendered.blockId,
    uri: 'file:///tmp/test.md',
    version: 1,
    kind: rendered.kind,
    startLine: rendered.startLine,
    endLine: rendered.endLine,
    startOffset: 0,
    endOffset: rendered.raw.length,
    ordinal: index,
    raw: rendered.raw,
  };
}

function model(id: string, blocks: RenderedBlockModel[]): RenderViewModel {
  return {
    uri: `file:///tmp/${id}.md`,
    version: 1,
    title: id,
    html: blocks.map(item => item.html).join('\n'),
    themeCss: '',
    previewCss: '',
    pageCss: '',
    blocks: Object.fromEntries(blocks.map(item => [item.blockId, item])),
    blockMap: blocks.map(blockMapEntry),
    activeThemeId: 'test',
    activePageProfileId: 'test',
    editable: true,
    commitOnBlur: false,
    trusted: true,
    copyMode: 'plainText',
    syntaxCss: '',
  };
}

describe('block diff presentation', () => {
  it('builds side-by-side diff markers for modified, deleted, and added markdown blocks', () => {
    const previous = model('previous', [
      block('old-h1', 'heading', 'Previous doc version', 0),
      block('same-p', 'paragraph', 'Which says this.', 2),
      block('old-h2', 'heading', 'And also this', 4),
      block('same-em', 'paragraph', 'And this.', 6),
      block('tail', 'paragraph', 'And ends here.', 8),
    ]);

    const current = model('current', [
      block('new-h1', 'heading', 'Saved and Uncommitted doc version', 0),
      block('same-p', 'paragraph', 'Which says this.', 2),
      block('same-em', 'paragraph', 'And this.', 4),
      block('new-p', 'paragraph', 'But now also this.', 5),
      block('tail', 'paragraph', 'And ends here.', 8),
    ]);

    const { original, modified } = buildSideBySideDiffPresentations(previous, current, 'Open Changes');

    assert.strictEqual(original.mode, 'diff');
    assert.strictEqual(modified.mode, 'diff');
    assert.strictEqual(original.side, 'original');
    assert.strictEqual(modified.side, 'modified');

    assert.strictEqual(original.blocks['old-h1']?.state, 'modified');
    assert.strictEqual(modified.blocks['new-h1']?.state, 'modified');
    assert.ok((original.blocks['old-h1']?.inlineRanges?.length ?? 0) > 0);
    assert.ok((modified.blocks['new-h1']?.inlineRanges?.length ?? 0) > 0);
    assert.ok((original.blocks['old-h1']?.inlineRanges ?? []).every(range => range.tone === 'removed'));
    assert.ok((modified.blocks['new-h1']?.inlineRanges ?? []).every(range => range.tone === 'added'));

    assert.strictEqual(original.blocks['old-h2']?.state, 'deleted');
    assert.strictEqual(modified.blocks['new-p']?.state, 'added');

    assert.ok(original.placeholders.some(item => item.kind === 'added'));
    assert.ok(modified.placeholders.some(item => item.kind === 'deleted'));
    assert.ok(Boolean(original.firstAnchorId));
    assert.ok(Boolean(modified.firstAnchorId));
  });

  it('builds a working-tree presentation with deletion markers for removed markdown blocks', () => {
    const base = model('base', [
      block('intro', 'paragraph', 'Intro', 0),
      block('removed', 'paragraph', 'This block is gone.', 2),
      block('tail', 'paragraph', 'Tail', 4),
    ]);

    const current = model('current', [
      block('intro', 'paragraph', 'Intro', 0),
      block('tail', 'paragraph', 'Tail', 2),
    ]);

    const presentation = buildWorkingTreeDiffPresentation(base, current, 'Working tree');

    assert.strictEqual(presentation.mode, 'git');
    assert.strictEqual(presentation.summary.deleted, 1);
    assert.strictEqual(presentation.deletionMarkers.length, 1);
    assert.strictEqual(presentation.blocks['intro']?.state, 'unchanged');
    assert.strictEqual(presentation.blocks['tail']?.state, 'unchanged');
    assert.ok(Boolean(presentation.firstAnchorId));
  });

  it('builds a working-tree presentation with added blocks highlighted in the current canvas', () => {
    const base = model('base', [
      block('intro', 'paragraph', 'Intro', 0),
      block('tail', 'paragraph', 'Tail', 2),
    ]);

    const current = model('current', [
      block('intro', 'paragraph', 'Intro', 0),
      block('inserted', 'paragraph', 'Fresh content.', 2),
      block('tail', 'paragraph', 'Tail', 4),
    ]);

    const presentation = buildWorkingTreeDiffPresentation(base, current, 'Working tree');

    assert.strictEqual(presentation.summary.added, 1);
    assert.strictEqual(presentation.blocks['inserted']?.state, 'added');
    assert.strictEqual(presentation.deletionMarkers.length, 0);
    assert.ok(Boolean(presentation.firstAnchorId));
  });
});
