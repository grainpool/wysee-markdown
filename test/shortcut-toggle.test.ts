import * as assert from 'assert';
const shortcuts = require('../media/wysee-editor-shortcuts.js');

describe('formatting shortcut toggles', () => {
  it('toggles bold on and off while preserving selection', () => {
    const applied = shortcuts.toggleBold('render', 0, 6);
    assert.strictEqual(applied.text, '**render**');
    assert.deepStrictEqual([applied.selectionStart, applied.selectionEnd], [2, 8]);

    const removed = shortcuts.toggleBold(applied.text, applied.selectionStart, applied.selectionEnd);
    assert.strictEqual(removed.text, 'render');
    assert.deepStrictEqual([removed.selectionStart, removed.selectionEnd], [0, 6]);
  });

  it('cycles exact star counts for bold and italic transitions', () => {
    const boldThenItalic = shortcuts.toggleItalic('**side**', 2, 6);
    assert.strictEqual(boldThenItalic.text, '***side***');
    assert.deepStrictEqual([boldThenItalic.selectionStart, boldThenItalic.selectionEnd], [3, 7]);

    const backToItalicOnly = shortcuts.toggleBold(boldThenItalic.text, boldThenItalic.selectionStart, boldThenItalic.selectionEnd);
    assert.strictEqual(backToItalicOnly.text, '*side*');
    assert.deepStrictEqual([backToItalicOnly.selectionStart, backToItalicOnly.selectionEnd], [1, 5]);

    const italicThenBold = shortcuts.toggleBold('*side*', 1, 5);
    assert.strictEqual(italicThenBold.text, '***side***');
    assert.deepStrictEqual([italicThenBold.selectionStart, italicThenBold.selectionEnd], [3, 7]);

    const backToBoldOnly = shortcuts.toggleItalic(italicThenBold.text, italicThenBold.selectionStart, italicThenBold.selectionEnd);
    assert.strictEqual(backToBoldOnly.text, '**side**');
    assert.deepStrictEqual([backToBoldOnly.selectionStart, backToBoldOnly.selectionEnd], [2, 6]);
  });

  it('toggles links without nesting wrappers', () => {
    const wrapped = shortcuts.toggleLink('client', 0, 6, 'url');
    assert.strictEqual(wrapped.text, '[client](url)');
    assert.deepStrictEqual([wrapped.selectionStart, wrapped.selectionEnd], [1, 7]);

    const boldedInsideLink = shortcuts.toggleBold(wrapped.text, wrapped.selectionStart, wrapped.selectionEnd);
    assert.strictEqual(boldedInsideLink.text, '[**client**](url)');
    assert.deepStrictEqual([boldedInsideLink.selectionStart, boldedInsideLink.selectionEnd], [3, 9]);

    const unlinked = shortcuts.toggleLink(boldedInsideLink.text, boldedInsideLink.selectionStart, boldedInsideLink.selectionEnd, 'url');
    assert.strictEqual(unlinked.text, '**client**');
    assert.deepStrictEqual([unlinked.selectionStart, unlinked.selectionEnd], [2, 8]);
  });

  it('normalizes mixed bold italic link sequences without star explosions', () => {
    let result = { text: 'text', selectionStart: 0, selectionEnd: 4 };
    const apply = (kind: 'bold' | 'italic' | 'link') => {
      if (kind === 'bold') {
        result = shortcuts.toggleBold(result.text, result.selectionStart, result.selectionEnd);
      } else if (kind === 'italic') {
        result = shortcuts.toggleItalic(result.text, result.selectionStart, result.selectionEnd);
      } else {
        result = shortcuts.toggleLink(result.text, result.selectionStart, result.selectionEnd, 'url');
      }
    };

    ['bold', 'italic', 'link', 'bold', 'italic', 'link', 'link', 'bold', 'italic', 'link', 'link'].forEach((kind) => apply(kind as any));

    assert.strictEqual(result.text, '[***text***](url)');
    assert.deepStrictEqual([result.selectionStart, result.selectionEnd], [4, 8]);
    assert.ok(!/\*{4,}/.test(result.text));
  });

  it('removes formatting when the wrapper or wrapped interior is selected', () => {
    const italicWrapped = shortcuts.toggleItalic('*like this one here*', 0, '*like this one here*'.length);
    assert.strictEqual(italicWrapped.text, 'like this one here');
    assert.deepStrictEqual([italicWrapped.selectionStart, italicWrapped.selectionEnd], [0, 18]);

    const italicInner = shortcuts.toggleItalic('*like this one here*', 1, 19);
    assert.strictEqual(italicInner.text, 'like this one here');
    assert.deepStrictEqual([italicInner.selectionStart, italicInner.selectionEnd], [0, 18]);

    const linkedWrapped = shortcuts.toggleLink('[***text***](url)', 0, '[***text***](url)'.length, 'url');
    assert.strictEqual(linkedWrapped.text, '***text***');
    assert.deepStrictEqual([linkedWrapped.selectionStart, linkedWrapped.selectionEnd], [3, 7]);
  });

  it('preserves inner partial selections when unwrapping links', () => {
    const linked = '[**client**](url)';
    const innerSelection = shortcuts.toggleLink(linked, 3, 6, 'url');
    assert.strictEqual(innerSelection.text, '**client**');
    assert.deepStrictEqual([innerSelection.selectionStart, innerSelection.selectionEnd], [2, 5]);
    assert.strictEqual(innerSelection.text.slice(innerSelection.selectionStart, innerSelection.selectionEnd), 'cli');
  });

  it('canonicalizes emphasis around links in either nesting order', () => {
    const removeBoldFromOuter = shortcuts.toggleBold('***[text](url)***', 0, '***[text](url)***'.length);
    assert.strictEqual(removeBoldFromOuter.text, '[*text*](url)');
    assert.deepStrictEqual([removeBoldFromOuter.selectionStart, removeBoldFromOuter.selectionEnd], [2, 6]);

    const addItalicInsideLink = shortcuts.toggleItalic('[**text**](url)', 3, 7);
    assert.strictEqual(addItalicInsideLink.text, '[***text***](url)');
    assert.deepStrictEqual([addItalicInsideLink.selectionStart, addItalicInsideLink.selectionEnd], [4, 8]);
  });

  it('refuses to create nested links across an existing link overlap', () => {
    const unchanged = shortcuts.toggleLink('pre [text](url) post', 0, 10, 'url');
    assert.strictEqual(unchanged.changed, false);
    assert.strictEqual(unchanged.text, 'pre [text](url) post');
  });
});
