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

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WyseeEditorShortcuts = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function normalizeSelection(start, end) {
    return start <= end ? { start: start, end: end } : { start: end, end: start };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function replaceRange(text, start, end, replacement) {
    return text.slice(0, start) + replacement + text.slice(end);
  }

  function setSelection(resultText, selectionStart, selectionEnd) {
    return {
      text: resultText,
      selectionStart: selectionStart,
      selectionEnd: selectionEnd,
      changed: true,
    };
  }

  function countRunBackward(text, index, char) {
    var count = 0;
    for (var i = index - 1; i >= 0 && text[i] === char; i -= 1) {
      count += 1;
    }
    return count;
  }

  function countRunForward(text, index, char) {
    var count = 0;
    for (var i = index; i < text.length && text[i] === char; i += 1) {
      count += 1;
    }
    return count;
  }

  function findMatchingBracket(text, openIndex) {
    var depth = 1;
    for (var i = openIndex + 1; i < text.length; i += 1) {
      var ch = text[i];
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '[') {
        depth += 1;
        continue;
      }
      if (ch === ']') {
        depth -= 1;
        if (depth === 0) {
          return i;
        }
      }
    }
    return -1;
  }

  function findMatchingParen(text, openIndex) {
    var depth = 1;
    for (var i = openIndex + 1; i < text.length; i += 1) {
      var ch = text[i];
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '(') {
        depth += 1;
        continue;
      }
      if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          return i;
        }
      }
    }
    return -1;
  }

  function findInlineLinks(text) {
    var links = [];
    for (var i = 0; i < text.length; i += 1) {
      if (text[i] !== '[' || text[i + 1] === '^' || text[i - 1] === '!') {
        continue;
      }
      var closeBracket = findMatchingBracket(text, i);
      if (closeBracket < 0 || text[closeBracket + 1] !== '(') {
        continue;
      }
      var closeParen = findMatchingParen(text, closeBracket + 1);
      if (closeParen < 0) {
        continue;
      }
      links.push({
        overallStart: i,
        overallEnd: closeParen + 1,
        textStart: i + 1,
        textEnd: closeBracket,
        hrefStart: closeBracket + 2,
        hrefEnd: closeParen,
        href: text.slice(closeBracket + 2, closeParen),
      });
      i = closeParen;
    }
    return links;
  }

  function rangesOverlap(startA, endA, startB, endB) {
    return Math.max(startA, startB) < Math.min(endA, endB);
  }

  function findSmallestContainingLink(links, start, end, allowUrlOnly) {
    var best = null;
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      if (link.overallStart > start || link.overallEnd < end) {
        continue;
      }
      if (!allowUrlOnly && start >= link.hrefStart && end <= link.hrefEnd) {
        continue;
      }
      if (!best || (link.overallEnd - link.overallStart) < (best.overallEnd - best.overallStart)) {
        best = link;
      }
    }
    return best;
  }

  function findExactLink(links, start, end) {
    for (var i = 0; i < links.length; i += 1) {
      var link = links[i];
      if (link.overallStart === start && link.overallEnd === end) {
        return link;
      }
    }
    return null;
  }

  function selectionOverlapsExistingLink(links, start, end) {
    for (var i = 0; i < links.length; i += 1) {
      if (rangesOverlap(start, end, links[i].overallStart, links[i].overallEnd)) {
        return true;
      }
    }
    return false;
  }

  function exactOuterEmphasisLength(text, start, end) {
    var before = countRunBackward(text, start, '*');
    var after = countRunForward(text, end, '*');
    if (before !== after) {
      return 0;
    }
    return before === 1 || before === 2 || before === 3 ? before : 0;
  }

  function exactInnerEmphasisLength(text, start, end) {
    var before = countRunForward(text, start, '*');
    var after = countRunBackward(text, end, '*');
    if (before !== after) {
      return 0;
    }
    if (!(before === 1 || before === 2 || before === 3)) {
      return 0;
    }
    if (end - start <= before * 2) {
      return 0;
    }
    return before;
  }

  function expandSelectionRegion(text, start, end, links, allowUrlOnly) {
    var regionStart = start;
    var regionEnd = end;
    var changed = true;

    while (changed) {
      changed = false;
      var containingLink = findSmallestContainingLink(links, regionStart, regionEnd, allowUrlOnly);
      if (containingLink && (containingLink.overallStart !== regionStart || containingLink.overallEnd !== regionEnd)) {
        regionStart = containingLink.overallStart;
        regionEnd = containingLink.overallEnd;
        changed = true;
        continue;
      }

      var outerEmphasis = exactOuterEmphasisLength(text, regionStart, regionEnd);
      if (outerEmphasis > 0) {
        regionStart -= outerEmphasis;
        regionEnd += outerEmphasis;
        changed = true;
      }
    }

    return { regionStart: regionStart, regionEnd: regionEnd };
  }

  function analyzeFormattingRegion(text, regionStart, regionEnd, links) {
    var coreStart = regionStart;
    var coreEnd = regionEnd;
    var bold = false;
    var italic = false;
    var link = false;
    var href = 'url';
    var changed = true;

    while (changed && coreStart < coreEnd) {
      changed = false;

      var exactLink = findExactLink(links, coreStart, coreEnd);
      if (exactLink) {
        link = true;
        href = exactLink.href || 'url';
        coreStart = exactLink.textStart;
        coreEnd = exactLink.textEnd;
        changed = true;
        continue;
      }

      var innerEmphasis = exactInnerEmphasisLength(text, coreStart, coreEnd);
      if (innerEmphasis > 0) {
        if (innerEmphasis === 1) {
          italic = true;
        } else if (innerEmphasis === 2) {
          bold = true;
        } else {
          bold = true;
          italic = true;
        }
        coreStart += innerEmphasis;
        coreEnd -= innerEmphasis;
        changed = true;
      }
    }

    return {
      regionStart: regionStart,
      regionEnd: regionEnd,
      coreStart: coreStart,
      coreEnd: coreEnd,
      bold: bold,
      italic: italic,
      link: link,
      href: href,
    };
  }

  function getCoreSelectionOffsets(start, end, coreStart, coreEnd) {
    var clampedStart = clamp(start, coreStart, coreEnd);
    var clampedEnd = clamp(end, coreStart, coreEnd);
    return {
      start: Math.min(clampedStart, clampedEnd) - coreStart,
      end: Math.max(clampedStart, clampedEnd) - coreStart,
    };
  }

  function buildCanonicalReplacement(coreText, bold, italic, link, href) {
    var emphasisLength = bold && italic ? 3 : (bold ? 2 : (italic ? 1 : 0));
    var emphasis = emphasisLength ? '*'.repeat(emphasisLength) : '';
    var inner = emphasis + coreText + emphasis;
    var replacement = link ? ('[' + inner + '](' + (href || 'url') + ')') : inner;
    return {
      text: replacement,
      emphasisLength: emphasisLength,
      prefixLength: (link ? 1 : 0) + emphasisLength,
    };
  }

  function toggleWrappedFormat(text, start, end, kind, target) {
    var selection = normalizeSelection(start, end);
    start = selection.start;
    end = selection.end;

    if (start === end) {
      if (kind === 'link') {
        var emptyLink = '[](' + (target || 'url') + ')';
        var nextLinkText = replaceRange(text, start, end, emptyLink);
        return setSelection(nextLinkText, start + 1, start + 1);
      }
      var emptyLength = kind === 'bold' ? 2 : 1;
      var emptyWrap = '*'.repeat(emptyLength) + '*'.repeat(emptyLength);
      var nextEmptyText = replaceRange(text, start, end, emptyWrap);
      return setSelection(nextEmptyText, start + emptyLength, start + emptyLength);
    }

    var links = findInlineLinks(text);
    var allowUrlOnly = kind === 'link';
    var expanded = expandSelectionRegion(text, start, end, links, allowUrlOnly);
    var current = analyzeFormattingRegion(text, expanded.regionStart, expanded.regionEnd, links);

    if (kind === 'link' && !current.link && selectionOverlapsExistingLink(links, start, end)) {
      return { text: text, selectionStart: start, selectionEnd: end, changed: false };
    }

    var coreText = text.slice(current.coreStart, current.coreEnd);
    var selectionOffsets = getCoreSelectionOffsets(start, end, current.coreStart, current.coreEnd);
    var nextBold = current.bold;
    var nextItalic = current.italic;
    var nextLink = current.link;

    if (kind === 'bold') {
      nextBold = !nextBold;
    } else if (kind === 'italic') {
      nextItalic = !nextItalic;
    } else if (kind === 'link') {
      nextLink = !nextLink;
    }

    var replacement = buildCanonicalReplacement(coreText, nextBold, nextItalic, nextLink, current.link ? current.href : (target || 'url'));
    var nextText = replaceRange(text, current.regionStart, current.regionEnd, replacement.text);
    var nextSelectionStart = current.regionStart + replacement.prefixLength + selectionOffsets.start;
    var nextSelectionEnd = current.regionStart + replacement.prefixLength + selectionOffsets.end;
    return setSelection(nextText, nextSelectionStart, nextSelectionEnd);
  }

  return {
    toggleBold: function (text, start, end) { return toggleWrappedFormat(text, start, end, 'bold'); },
    toggleItalic: function (text, start, end) { return toggleWrappedFormat(text, start, end, 'italic'); },
    toggleLink: function (text, start, end, target) { return toggleWrappedFormat(text, start, end, 'link', target); },
  };
}));
