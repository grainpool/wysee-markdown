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

(() => {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('wysee-root');
  const overlayHost = document.getElementById('wysee-overlay-host');
  const syncCheckbox = document.getElementById('wysee-sync-scroll');
  const wordCountEl = document.getElementById('wysee-word-count');
  const moreStatsButton = document.getElementById('wysee-more-stats');
  const findBar = document.getElementById('wysee-find-bar');
  const findInput = document.getElementById('wysee-find-input');
  const findStatus = document.getElementById('wysee-find-status');
  const findPrevButton = document.getElementById('wysee-find-prev');
  const findNextButton = document.getElementById('wysee-find-next');
  const findCloseButton = document.getElementById('wysee-find-close');
  const findHighlightAllCheckbox = document.getElementById('wysee-find-highlight-all');
  const findMatchCaseCheckbox = document.getElementById('wysee-find-match-case');
  const findMatchMarkdownCheckbox = document.getElementById('wysee-find-match-markdown');
  const exportMenuBtn = document.getElementById('wysee-export-menu-btn');
  const exportOverlay = document.getElementById('wysee-export-overlay');
  const themeStyle = document.createElement('style');
  themeStyle.id = 'wysee-theme-style';
  document.head.appendChild(themeStyle);

  const state = {
    model: null,
    selectedBlockId: undefined,
    hoveredBlockId: undefined,
    mermaidReady: null,
    katexReady: null,
    editable: true,
    copyMode: 'plainText',
    syncScroll: window.__WYSEE_SYNC_DEFAULT__ ?? true,
    pendingPreviews: {},
    diff: null,
    diffLayoutByGroup: {},
    lastDiffAnchorKey: '',
    lastReportedDiffLayoutKey: '',
    diffHunkIndex: -1,
    diffCollapsed: false,
    diffExpandedRuns: new Set(),
    activePanel: null, // { el, mode, blockId?, afterBlockId?, boundary?, originalBlockEl?, textarea? }
    modal: null, // { kind: 'stats' | 'dangling' }
    find: {
      lastQuery: '',
      lastMode: '',
      lastCriteriaKey: '',
      highlightAll: findHighlightAllCheckbox ? findHighlightAllCheckbox.checked : true,
      matchCase: findMatchCaseCheckbox ? findMatchCaseCheckbox.checked : false,
      matchMarkdown: findMatchMarkdownCheckbox ? findMatchMarkdownCheckbox.checked : false,
      results: [],
      activeIndex: -1,
      overlayLayer: null,
    },
  };

  let diffLayoutReportTimer = 0;

  function scheduleDiffLayoutReport() {
    clearTimeout(diffLayoutReportTimer);
    diffLayoutReportTimer = window.setTimeout(() => {
      reportDiffLayoutMeasurements();
    }, 40);
  }

  window.addEventListener('resize', () => {
    if (state.diff?.mode === 'diff') {
      scheduleDiffLayoutReport();
    }
  });

  // ── Diff hunk navigation (keyboard + gutter click delegation) ──
  document.addEventListener('keydown', (e) => {
    if (!state.diff || !state.diff.hunks?.length) return;
    if (e.altKey && e.shiftKey && e.key === 'ArrowUp') {
      e.preventDefault();
      navigateHunk('previous');
    }
    if (e.altKey && e.shiftKey && e.key === 'ArrowDown') {
      e.preventDefault();
      navigateHunk('next');
    }
  });

  root.addEventListener('click', (e) => {
    const navBtn = e.target.closest('.wysee-hunk-nav-btn');
    if (navBtn) {
      e.stopPropagation();
      const dir = navBtn.dataset.wyseeHunkDir;
      if (dir === 'prev' || dir === 'next') {
        navigateHunk(dir === 'prev' ? 'previous' : 'next');
      }
      return;
    }
    // Click on a placeholder or deletion marker → move nav to its parent hunk
    const diffEl = e.target.closest('.wysee-diff-placeholder, .wysee-diff-deletion-marker');
    if (diffEl && state.diff?.hunks?.length) {
      const groupId = diffEl.dataset.wyseeDiffGroupId;
      if (groupId) {
        const hunkIdx = state.diff.hunks.findIndex((h) => h.groupId === groupId);
        if (hunkIdx >= 0 && hunkIdx !== state.diffHunkIndex) {
          state.diffHunkIndex = hunkIdx;
          renderHunkGutterNav();
          applyHunkFocusPulse(state.diff.hunks[hunkIdx]);
        }
      }
    }
  });

  // ── Sync scroll ──
  syncCheckbox?.addEventListener('change', () => {
    state.syncScroll = syncCheckbox.checked;
    vscode.postMessage({ type: 'syncScrollChanged', enabled: state.syncScroll });
  });

  moreStatsButton?.addEventListener('click', () => {
    openStatsModal();
  });

  // ── Export options popup ──
  exportMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    exportOverlay?.classList.toggle('is-visible');
  });
  exportOverlay?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wysee-action]');
    if (btn) {
      const action = btn.dataset.wyseeAction;
      if (action) {
        vscode.postMessage({ type: 'exportAction', action });
      }
      exportOverlay.classList.remove('is-visible');
      return;
    }
    // Click on backdrop closes the popup
    if (e.target === exportOverlay) {
      exportOverlay.classList.remove('is-visible');
    }
  });

  findPrevButton?.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
  findNextButton?.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
  findCloseButton?.addEventListener('mousedown', (e) => {
    e.preventDefault();
  });
  findPrevButton?.addEventListener('click', () => {
    performFind('previous', { resetFromInput: false, preserveInputFocus: true });
  });
  findNextButton?.addEventListener('click', () => {
    performFind('next', { resetFromInput: false, preserveInputFocus: true });
  });
  findCloseButton?.addEventListener('click', () => {
    closeFindBar();
  });
  findHighlightAllCheckbox?.addEventListener('change', () => {
    state.find.highlightAll = findHighlightAllCheckbox.checked;
    renderCanvasFindHighlights();
    focusFindInput(false);
  });
  findMatchCaseCheckbox?.addEventListener('change', () => {
    state.find.matchCase = findMatchCaseCheckbox.checked;
    refreshOpenFindResults({ direction: 'next', preserveInputFocus: true });
  });
  findMatchMarkdownCheckbox?.addEventListener('change', () => {
    state.find.matchMarkdown = findMatchMarkdownCheckbox.checked;
    refreshOpenFindResults({ direction: 'next', preserveInputFocus: true });
  });
  findInput?.addEventListener('input', () => {
    performFind('next', { resetFromInput: true, preserveInputFocus: true });
  });
  findInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      performFind(e.shiftKey ? 'previous' : 'next', { resetFromInput: false, preserveInputFocus: true });
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeFindBar();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
    }
  });

  overlayHost?.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-wysee-modal-close="true"]');
    if (closeButton) {
      closeModal();
      return;
    }
    const actionButton = event.target.closest('[data-wysee-modal-action]');
    if (actionButton) {
      const action = actionButton.getAttribute('data-wysee-modal-action');
      if (action === 'openDanglingIssues') {
        openDanglingIssuesModal();
      }
      return;
    }
    const issueButton = event.target.closest('[data-wysee-issue-id]');
    if (issueButton) {
      navigateToIssue(issueButton.getAttribute('data-wysee-issue-id'));
      return;
    }
    if (event.target.classList.contains('wysee-modal-backdrop')) {
      closeModal();
    }
  });

  // ── Scroll sync (block-anchor mapping with directional locking) ──
  // Maps scroll positions through block anchors so that a 400px mermaid diagram
  // (covering 10 source lines) scrolls proportionally through those 10 lines,
  // not proportionally through the whole document height.
  let scrollDriver = 'none'; // 'webview' | 'source' | 'peer' | 'none'
  let scrollDriverTimer = null;

  function claimScrollDriver(who) {
    scrollDriver = who;
    clearTimeout(scrollDriverTimer);
    // Short locks for echo absorption only; long enough to catch the
    // scroll event triggered by our own scrollTo/revealRange
    const lockMs = who === 'peer' ? 80 : who === 'source' ? 100 : 100;
    scrollDriverTimer = setTimeout(() => { scrollDriver = 'none'; }, lockMs);
  }

  // Compute the fractional source line at the viewport top using block anchors
  function getSourceLineAtViewportTop() {
    const blocks = [...root.querySelectorAll(':scope > [data-wysee-block-id][data-wysee-start-line]')];
    if (!blocks.length) return 0;
    const viewTop = window.scrollY + 60; // offset for top bars
    let prev = blocks[0];
    for (const b of blocks) {
      const top = b.offsetTop;
      if (top > viewTop) break;
      prev = b;
    }
    const blockTop = prev.offsetTop;
    const blockHeight = prev.offsetHeight || 1;
    const startLine = Number(prev.dataset.wyseeStartLine || 0);
    const endLine = Number(prev.dataset.wyseeEndLine || startLine);
    const lineSpan = endLine - startLine + 1;
    const frac = Math.max(0, Math.min(1, (viewTop - blockTop) / blockHeight));
    return startLine + frac * lineSpan;
  }

  // Scroll the webview so that a given source line is at the viewport top
  function scrollWebviewToSourceLine(targetLine) {
    const blocks = [...root.querySelectorAll(':scope > [data-wysee-block-id][data-wysee-start-line]')];
    if (!blocks.length) return;
    let prev = blocks[0];
    for (const b of blocks) {
      const sl = Number(b.dataset.wyseeStartLine || 0);
      if (sl > targetLine) break;
      prev = b;
    }
    const startLine = Number(prev.dataset.wyseeStartLine || 0);
    const endLine = Number(prev.dataset.wyseeEndLine || startLine);
    const lineSpan = endLine - startLine + 1;
    const frac = lineSpan > 0 ? Math.max(0, Math.min(1, (targetLine - startLine) / lineSpan)) : 0;
    const targetY = prev.offsetTop + frac * (prev.offsetHeight || 0) - 60;
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'auto' });
  }

  function getViewportScrollMetrics() {
    const scrollingEl = document.scrollingElement || document.documentElement || document.body;
    const maxTop = Math.max(0, (scrollingEl?.scrollHeight || 0) - window.innerHeight);
    const top = Math.max(0, Math.min(maxTop, window.scrollY || scrollingEl?.scrollTop || 0));
    return {
      top,
      maxTop,
      ratio: maxTop > 0 ? top / maxTop : 0,
    };
  }

  function scrollWebviewToViewportRatio(targetRatio) {
    const { maxTop } = getViewportScrollMetrics();
    const ratio = Math.max(0, Math.min(1, Number.isFinite(targetRatio) ? targetRatio : 0));
    window.scrollTo({ top: maxTop * ratio, behavior: 'auto' });
  }

  let scrollReportRaf = 0;
  let lastReportedLine = -1;
  let lastReportedViewportRatio = -1;

  function reportScroll() {
    if (!state.syncScroll || !state.model) return;
    if (scrollDriver === 'source' || scrollDriver === 'peer') return;
    claimScrollDriver('webview');

    // Use rAF for both modes — immediate, per-frame reporting
    if (!scrollReportRaf) {
      scrollReportRaf = requestAnimationFrame(() => {
        scrollReportRaf = 0;

        if (state.diff?.mode === 'diff') {
          const { ratio } = getViewportScrollMetrics();
          if (Math.abs(ratio - lastReportedViewportRatio) < 0.001) return;
          lastReportedViewportRatio = ratio;
          vscode.postMessage({ type: 'reportViewport', ratio });
          return;
        }

        const line = getSourceLineAtViewportTop();
        if (Math.abs(line - lastReportedLine) < 0.3) return;
        lastReportedLine = line;
        vscode.postMessage({ type: 'scrollSourceLine', line });
      });
    }
  }
  window.addEventListener('scroll', reportScroll, { passive: true });

  // ── Copy / Cut / Paste interception ──
  document.addEventListener('copy', (e) => {
    if (shouldAllowNativeClipboard()) return;
    e.preventDefault();
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim();

    if (hasSelection) {
      if (state.copyMode === 'sourceMarkdown') {
        const blockEls = getBlocksInSelection(selection);
        const rawParts = blockEls.map((el) => state.model?.blocks?.[el.dataset.wyseeBlockId]?.raw).filter(Boolean);
        e.clipboardData.setData('text/plain', rawParts.join('\n\n'));
      } else {
        const range = selection.getRangeAt(0);
        const fragment = range.cloneContents();
        fragment.querySelectorAll('.wysee-boundary').forEach((el) => el.remove());
        const temp = document.createElement('div');
        temp.appendChild(fragment);
        e.clipboardData.setData('text/plain', temp.innerText.replace(/\n{3,}/g, '\n\n').trim());
      }
    } else if (state.hoveredBlockId) {
      const block = state.model?.blocks?.[state.hoveredBlockId];
      if (block) {
        e.clipboardData.setData('text/plain', state.copyMode === 'sourceMarkdown' ? block.raw : block.plainText || block.raw);
      }
    }
  });

  document.addEventListener('cut', (e) => {
    if (!shouldAllowNativeClipboard()) {
      e.preventDefault();
    }
  });

  document.addEventListener('paste', (e) => {
    void handlePasteEvent(e);
  });

  async function handlePasteEvent(e) {
    const clipboard = e.clipboardData;
    const hasImageItems = Boolean(clipboard && [...clipboard.items].some((item) => item.type.startsWith('image/')));
    const canPasteIntoEditPanel = state.activePanel?.mode === 'edit' && isInPanelTextarea();
    const canPasteNearSelectedBlock = !state.modal && !state.activePanel && Boolean(state.selectedBlockId) && !isTypingControlFocused();

    if (hasImageItems) {
      e.preventDefault();
      if (!canPasteIntoEditPanel && !canPasteNearSelectedBlock) {
        return;
      }
      const images = await collectClipboardImages(clipboard);
      if (!images.length) {
        return;
      }
      vscode.postMessage({
        type: 'pasteClipboardImages',
        target: canPasteIntoEditPanel ? 'editPanel' : 'selectedBlock',
        blockId: canPasteNearSelectedBlock ? state.selectedBlockId : undefined,
        images,
      });
      return;
    }

    if (!shouldAllowNativeClipboard()) {
      e.preventDefault();
    }
  }

  // Ctrl+Z / Ctrl+Y handling:
  // - No panel open: send undo/redo to extension (webview is an iframe, keys don't reach VS Code)
  // - Panel open, in textarea: let browser handle native undo/redo
  // - Find input or other text inputs: let browser handle native undo/redo
  // - Panel open, NOT in textarea: block (prevent accidental doc undo)
  document.addEventListener('keydown', (e) => {
    const key = String(e.key || '').toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        if (document.activeElement === findInput) {
          findInput.focus();
          findInput.select();
          return;
        }
        openFindBar(getCurrentFindPrefill());
        return;
      }

      if (key === 'z' || key === 'y') {
        if (isNativeTextInputFocused()) {
          return;
        }
        if (!state.activePanel) {
          e.preventDefault();
          e.stopPropagation();
          const isRedo = key === 'y' || e.shiftKey;
          vscode.postMessage({ type: isRedo ? 'redo' : 'undo' });
        } else {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }
  }, true);

  document.addEventListener('selectionchange', () => {
    const text = window.getSelection()?.toString() || '';
    vscode.postMessage({ type: 'selection', hasSelection: Boolean(text), selectionText: text || undefined });
  });

  function isNativeTextInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    return active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT';
  }

  function shouldAllowNativeClipboard() {
    if (isNativeTextInputFocused()) {
      return true;
    }
    if (state.modal) {
      return true;
    }
    const active = document.activeElement;
    if (active && active !== document.body && !root.contains(active)) {
      return true;
    }
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      let container = selection.getRangeAt(0).commonAncestorContainer;
      if (container && container.nodeType !== Node.ELEMENT_NODE) {
        container = container.parentElement;
      }
      if (container && !root.contains(container)) {
        return true;
      }
    }
    return false;
  }

  function isTypingControlFocused() {
    const active = document.activeElement;
    if (!active || active === document.body) {
      return false;
    }
    return active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.tagName === 'SELECT';
  }

  function isInPanelTextarea() {
    const active = document.activeElement;
    return active && active.tagName === 'TEXTAREA' && active.closest('.wysee-editor-panel');
  }

  function getBlocksInSelection(selection) {
    const range = selection.getRangeAt(0);
    return [...root.querySelectorAll('[data-wysee-block-id]')].filter((el) => range.intersectsNode(el));
  }

  async function collectClipboardImages(clipboard) {
    const items = clipboard ? [...clipboard.items].filter((item) => item.type.startsWith('image/')) : [];
    const images = [];
    for (const item of items) {
      const file = item.getAsFile?.();
      if (!file) continue;
      try {
        images.push({ dataUrl: await blobToPngDataUrl(file), mimeType: 'image/png' });
      } catch (error) {
        console.warn('Failed to convert clipboard image:', error);
      }
    }
    return images;
  }

  function fileToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read image.'));
      reader.readAsDataURL(blob);
    });
  }

  function rasterizeDataUrlToPng(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width || 1;
          canvas.height = image.naturalHeight || image.height || 1;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not create image canvas.'));
            return;
          }
          ctx.drawImage(image, 0, 0);
          resolve(canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error('Could not decode clipboard image.'));
      image.src = dataUrl;
    });
  }

  async function blobToPngDataUrl(blob) {
    const originalDataUrl = await fileToDataUrl(blob);
    if (originalDataUrl.startsWith('data:image/png;')) {
      return originalDataUrl;
    }
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width || 1;
        canvas.height = bitmap.height || 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not create image canvas.');
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close?.();
        return canvas.toDataURL('image/png');
      } catch {
        // Fall through to <img> rasterization.
      }
    }
    return rasterizeDataUrlToPng(originalDataUrl);
  }

  // ── Context menu (right-click) — document-level ──
  root.addEventListener('contextmenu', (event) => {
    const target = event.target;

    if (state.activePanel) {
      if (target.closest('.wysee-editor-input-wrap textarea')) {
        vscode.postMessage({
          type: 'editPanelState', active: true, textareaFocused: true,
        });
        vscode.postMessage({
          type: 'context', canInsertBlock: true,
          hasSelection: Boolean(window.getSelection()?.toString()),
          selectionText: window.getSelection()?.toString() || undefined,
        });
        return;
      }
      vscode.postMessage({
        type: 'context', canInsertBlock: false,
        hasSelection: Boolean(window.getSelection()?.toString()),
        selectionText: window.getSelection()?.toString() || undefined,
      });
      return;
    }

    const blockEl = target.closest?.('[data-wysee-block-id]');
    if (blockEl) {
      const word = extractContextWord(target);
      vscode.postMessage({
        type: 'context',
        blockId: blockEl.dataset.wyseeBlockId,
        blockKind: blockEl.dataset.wyseeKind,
        word,
        hasSelection: Boolean(window.getSelection()?.toString()),
        selectionText: window.getSelection()?.toString() || undefined,
        canInsertBlock: true,
      });
      return;
    }

    const clickY = event.clientY;
    const allBlocks = [...root.querySelectorAll(':scope > [data-wysee-block-id]')];
    let insertAfterBlockId = null;
    for (const b of allBlocks) {
      const rect = b.getBoundingClientRect();
      if (rect.bottom <= clickY) {
        if (b.dataset.wyseeKind !== 'footnotes' && b.dataset.wyseeKind !== 'footnoteDefinition') {
          insertAfterBlockId = b.dataset.wyseeBlockId;
        }
      }
    }

    vscode.postMessage({
      type: 'context',
      canInsertBlock: true,
      insertAfterBlockId,
      hasSelection: Boolean(window.getSelection()?.toString()),
      selectionText: window.getSelection()?.toString() || undefined,
    });
  });

  // ── Message handling ──
  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (msg.type === 'render') {
      state.model = msg.model;
      state.diff = msg.model.diff || null;
      state.editable = Boolean(msg.model.editable);
      state.copyMode = msg.model.copyMode || 'plainText';
      themeStyle.textContent = `${msg.model.previewCss}
${msg.model.pageCss || ''}
${msg.model.syntaxCss || ''}`;
      root.innerHTML = msg.model.html;
      root.classList.toggle('is-diff-mode', state.diff?.mode === 'diff');
      root.classList.toggle('has-git-diff', Boolean(state.diff));
      if (state.diff?.side) {
        root.dataset.wyseeDiffSide = state.diff.side;
      } else {
        delete root.dataset.wyseeDiffSide;
      }
      if (state.activePanel && !document.body.contains(state.activePanel.el)) {
        state.activePanel = null;
        vscode.postMessage({ type: 'editPanelState', active: false });
      }
      applyDiffPresentation();
      bindRoot();
      injectBoundaries();
      renderStatsSummary();
      rerenderOpenModal();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await hydrateMermaid();
      await hydrateKatex();
      restoreSelected();
      refreshOpenFindResults({ preserveInputFocus: true });
      // Initialize hunk index from firstAnchorId or default to first hunk
      if (state.diff?.hunks?.length) {
        let targetIdx = 0; // default to first hunk
        if (state.diff.firstAnchorId) {
          // Find the hunk whose anchorId or groupId matches firstAnchorId
          const anchor = state.diff.firstAnchorId;
          const matchIdx = state.diff.hunks.findIndex((h) =>
            h.anchorId === anchor || h.groupId === anchor
          );
          if (matchIdx >= 0) targetIdx = matchIdx;
          // Also check if firstAnchorId is a blockId belonging to a hunk's group
          if (matchIdx < 0 && state.diff.blocks) {
            const blockInfo = state.diff.blocks[anchor];
            if (blockInfo?.groupId) {
              const groupMatch = state.diff.hunks.findIndex((h) => h.groupId === blockInfo.groupId);
              if (groupMatch >= 0) targetIdx = groupMatch;
            }
          }
        }
        // Preserve existing valid index on re-render of same diff
        if (state.diffHunkIndex >= 0 && state.diffHunkIndex < state.diff.hunks.length) {
          // keep it
        } else {
          state.diffHunkIndex = targetIdx;
        }
      } else {
        state.diffHunkIndex = -1;
      }
      renderHunkGutterNav();
      // Fire initial focus pulse on the active hunk
      if (state.diffHunkIndex >= 0 && state.diff?.hunks?.[state.diffHunkIndex]) {
        applyHunkFocusPulse(state.diff.hunks[state.diffHunkIndex]);
      }
      applyCollapseState();
      if (state.diff?.mode === 'diff') {
        scheduleDiffLayoutReport();
        lastReportedViewportRatio = getViewportScrollMetrics().ratio;
        // Re-render gutter nav after layout settles (heights may change)
        setTimeout(() => renderHunkGutterNav(), 200);
      } else {
        state.lastReportedDiffLayoutKey = '';
        lastReportedViewportRatio = -1;
      }
      if (state.diff?.mode === 'diff' && state.diff.firstAnchorId) {
        const anchorKey = `${msg.model.uri}|${msg.model.version}|${state.diff.firstAnchorId}`;
        if (anchorKey !== state.lastDiffAnchorKey) {
          state.lastDiffAnchorKey = anchorKey;
          scrollDiffAnchorIntoView(state.diff.firstAnchorId);
        }
      } else {
        state.lastDiffAnchorKey = '';
      }
      return;
    }

    if (msg.type === 'setEditable') { state.editable = Boolean(msg.editable); return; }
    if (msg.type === 'showError') { alert(msg.message); return; }
    if (msg.type === 'showInfo') { console.info(msg.message); return; }
    if (msg.type === 'previewResult') {
      const cb = state.pendingPreviews[msg.requestId];
      if (cb) { cb(msg.html); delete state.pendingPreviews[msg.requestId]; }
      return;
    }
    if (msg.type === 'scrollToSourceLine') {
      if (state.diff?.mode === 'diff') return;
      if (scrollDriver === 'webview') return;
      claimScrollDriver('source');
      scrollWebviewToSourceLine(msg.line);
      return;
    }
    if (msg.type === 'scrollToBlock') {
      claimScrollDriver('source');
      const el = root.querySelector(`[data-wysee-block-id="${CSS.escape(msg.blockId)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (msg.type === 'scrollToLine') {
      claimScrollDriver('source');
      const el = root.querySelector(`[data-wysee-start-line="${msg.startLine}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (msg.type === 'highlightBlock') {
      selectBlock(msg.blockId);
      return;
    }
    if (msg.type === 'insertTemplateIntoTextarea') {
      if (state.activePanel?.textarea) {
        const ta = state.activePanel.textarea;
        ta.focus();
        ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
        document.execCommand('insertText', false, msg.text);
        ta.dispatchEvent(new Event('input'));
      }
      return;
    }
    if (msg.type === 'applyDiffLayout') {
      state.diffLayoutByGroup = Object.fromEntries((msg.measurements || [])
        .filter((item) => item && typeof item.groupId === 'string' && Number.isFinite(item.height))
        .map((item) => [item.groupId, Math.max(0, Math.round(item.height))]));
      applyMeasuredDiffLayout();
      return;
    }
    if (msg.type === 'syncViewport') {
      if (!state.syncScroll || state.diff?.mode !== 'diff') return;
      if (scrollDriver === 'webview') return;
      claimScrollDriver('peer');
      lastReportedViewportRatio = Math.max(0, Math.min(1, Number(msg.ratio) || 0));
      scrollWebviewToViewportRatio(lastReportedViewportRatio);
      return;
    }
    if (msg.type === 'setSyncScroll') {
      state.syncScroll = Boolean(msg.enabled);
      if (syncCheckbox) {
        syncCheckbox.checked = state.syncScroll;
      }
      return;
    }
    if (msg.type === 'openFind') {
      openFindBar();
    }
  });

  function applyDiffPresentation() {
    root.querySelectorAll('.wysee-diff-banner, .wysee-diff-placeholder, .wysee-diff-deletion-marker').forEach((el) => el.remove());
    if (!state.diff) {
      return;
    }

    if (state.diff.conflict) {
      const banner = document.createElement('div');
      banner.className = 'wysee-diff-banner';
      banner.textContent = `${state.diff.comparisonLabel || 'Merge conflict state'} — use the Merge Editor or source view to resolve conflicts.`;
      root.prepend(banner);
    }

    decorateBlocksForDiff();

    if (state.diff.mode === 'diff' && Array.isArray(state.diff.placeholders)) {
      for (const placeholder of state.diff.placeholders) {
        const el = document.createElement('div');
        el.className = `wysee-diff-placeholder wysee-diff-placeholder--${placeholder.kind}`;
        el.id = placeholder.id;
        el.setAttribute('data-wysee-diff-anchor', placeholder.id);
        el.style.setProperty('--wysee-diff-lines', String(Math.max(1, placeholder.lineCount || 1)));
        el.style.setProperty('--wysee-diff-blocks', String(Math.max(1, placeholder.blockCount || 1)));
        if (placeholder.groupId) {
          el.dataset.wyseeDiffGroupId = placeholder.groupId;
        }
        el.style.setProperty('--wysee-diff-px-height', `${estimatePlaceholderHeightPx(placeholder.lineCount, placeholder.blockCount)}px`);
        el.title = placeholder.kind === 'added' ? 'Added content on the opposite side' : 'Deleted content on the opposite side';
        insertBeforeBlockOrAppend(el, placeholder.beforeBlockId);
      }
    }

    if (state.diff.mode === 'git' && Array.isArray(state.diff.deletionMarkers)) {
      for (const marker of state.diff.deletionMarkers) {
        const el = document.createElement('div');
        el.className = 'wysee-diff-deletion-marker';
        el.id = marker.id;
        el.setAttribute('data-wysee-diff-anchor', marker.id);
        el.style.setProperty('--wysee-diff-lines', String(Math.max(1, marker.lineCount || 1)));
        if (marker.groupId) {
          el.dataset.wyseeDiffGroupId = marker.groupId;
        }
        el.title = 'Click to open diff view';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          // Find the line of the nearest block after this marker
          const nextBlock = el.nextElementSibling?.closest?.('[data-wysee-start-line]')
            || el.nextElementSibling;
          const line = Number(nextBlock?.dataset?.wyseeStartLine || 0);
          vscode.postMessage({ type: 'openDiffAtLine', line });
        });
        insertBeforeBlockOrAppend(el, marker.beforeBlockId);
      }
    }

    applyMeasuredDiffLayout();
  }

  function decorateBlocksForDiff() {
    root.querySelectorAll('[data-wysee-block-id]').forEach((el) => {
      const info = state.diff?.blocks?.[el.dataset.wyseeBlockId];
      if (!info || info.state === 'unchanged') {
        return;
      }

      el.dataset.wyseeDiffState = info.state;
      if (info.groupId) {
        el.dataset.wyseeDiffGroupId = info.groupId;
      }
      if (info.groupPosition) {
        el.dataset.wyseeDiffGroupPosition = info.groupPosition;
      }
      const gutter = document.createElement('span');
      gutter.className = `wysee-diff-gutter wysee-diff-gutter--${info.state === 'added' ? 'added' : info.state === 'deleted' ? 'deleted' : 'modified'}`;
      gutter.setAttribute('aria-hidden', 'true');
      if (state.diff?.mode === 'git') {
        gutter.title = 'Click to open diff view';
        gutter.addEventListener('click', (e) => {
          e.stopPropagation();
          const startLine = Number(el.dataset.wyseeStartLine || 0);
          vscode.postMessage({ type: 'openDiffAtLine', line: startLine });
        });
      }
      el.prepend(gutter);

      if (state.diff?.mode === 'diff') {
        el.classList.add('wysee-diff-block', `wysee-diff-block--${info.state}`);
        if (info.groupPosition) {
          el.classList.add(`wysee-diff-group--${info.groupPosition}`);
        }
      }

      if (state.diff?.mode === 'diff' && info.state === 'modified' && Array.isArray(info.inlineRanges) && info.inlineRanges.length) {
        applyInlineDiffRanges(el, info.inlineRanges);
      }
    });
  }

  function applyInlineDiffRanges(blockEl, ranges) {
    const sortedRanges = [...ranges]
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
      .sort((a, b) => a.start - b.start);
    if (!sortedRanges.length) {
      return;
    }

    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest('.wysee-diff-gutter')) {
          return NodeFilter.FILTER_REJECT;
        }
        const tag = parent.tagName?.toLowerCase();
        if (['script', 'style'].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes = [];
    let node;
    let offset = 0;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || '';
      textNodes.push({ node, start: offset, end: offset + value.length });
      offset += value.length;
    }

    for (const info of textNodes) {
      const overlapping = sortedRanges.filter((range) => range.end > info.start && range.start < info.end);
      if (!overlapping.length) {
        continue;
      }

      const text = info.node.nodeValue || '';
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const range of overlapping) {
        const localStart = Math.max(0, range.start - info.start);
        const localEnd = Math.min(text.length, range.end - info.start);
        if (localEnd <= localStart) {
          continue;
        }
        if (localStart > cursor) {
          fragment.append(document.createTextNode(text.slice(cursor, localStart)));
        }
        const span = document.createElement('span');
        span.className = `wysee-diff-inline wysee-diff-inline--${range.tone || 'modified'}`;
        span.textContent = text.slice(localStart, localEnd);
        fragment.append(span);
        cursor = localEnd;
      }
      if (cursor < text.length) {
        fragment.append(document.createTextNode(text.slice(cursor)));
      }
      info.node.parentNode?.replaceChild(fragment, info.node);
    }
  }

  function estimatePlaceholderHeightPx(lineCount, blockCount) {
    const lineHeight = parseFloat(window.getComputedStyle(root).lineHeight || '') || 22;
    const blockGap = 6;
    return Math.max(lineHeight, Math.round((Math.max(1, Number(lineCount) || 1) * lineHeight) + (Math.max(1, Number(blockCount) || 1) - 1) * blockGap + 6));
  }

  function applyMeasuredDiffLayout() {
    const elements = root.querySelectorAll('[data-wysee-diff-group-id].wysee-diff-placeholder, [data-wysee-diff-group-id].wysee-diff-deletion-marker');
    elements.forEach((el) => {
      const groupId = el.dataset.wyseeDiffGroupId;
      if (!groupId) {
        return;
      }
      const measuredHeight = state.diffLayoutByGroup?.[groupId];
      if (Number.isFinite(measuredHeight) && measuredHeight > 0) {
        el.style.setProperty('--wysee-diff-px-height', `${Math.round(measuredHeight)}px`);
      }
    });
    // Re-position gutter nav after height changes
    renderHunkGutterNav();
  }

  function reportDiffLayoutMeasurements() {
    if (state.diff?.mode !== 'diff') {
      state.lastReportedDiffLayoutKey = '';
      return;
    }
    const groups = Array.from(root.querySelectorAll('[data-wysee-diff-group-id].wysee-diff-block'));
    const measurements = [];
    const seen = new Set();
    for (const el of groups) {
      const groupId = el.dataset.wyseeDiffGroupId;
      if (!groupId || seen.has(groupId)) {
        continue;
      }
      seen.add(groupId);
      const members = groups.filter((candidate) => candidate.dataset.wyseeDiffGroupId === groupId);
      if (!members.length) {
        continue;
      }
      const firstRect = members[0].getBoundingClientRect();
      const lastRect = members[members.length - 1].getBoundingClientRect();
      const height = Math.max(1, Math.round(lastRect.bottom - firstRect.top));
      measurements.push({ groupId, height });
    }
    const nextKey = measurements.map((item) => `${item.groupId}:${item.height}`).sort().join('|');
    if (nextKey === state.lastReportedDiffLayoutKey) {
      return;
    }
    state.lastReportedDiffLayoutKey = nextKey;
    vscode.postMessage({ type: 'reportDiffLayout', measurements });
  }

  function insertBeforeBlockOrAppend(element, beforeBlockId) {
    if (beforeBlockId) {
      const before = root.querySelector(`[data-wysee-block-id="${CSS.escape(beforeBlockId)}"]`);
      if (before) {
        root.insertBefore(element, before);
        return;
      }
    }
    root.appendChild(element);
  }

  function scrollDiffAnchorIntoView(anchorId) {
    requestAnimationFrame(() => {
      const target = document.getElementById(anchorId)
        || root.querySelector(`[data-wysee-block-id="${CSS.escape(anchorId)}"]`)
        || root.querySelector(`[data-wysee-diff-anchor="${CSS.escape(anchorId)}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    });
  }

  // ── Diff hunk navigation (gutter-based) ──

  function navigateHunk(direction) {
    const hunks = state.diff?.hunks;
    if (!hunks || !hunks.length) return;

    let idx = state.diffHunkIndex;
    if (direction === 'next') {
      idx = idx < hunks.length - 1 ? idx + 1 : idx;
    } else {
      idx = idx > 0 ? idx - 1 : idx;
    }
    // If starting from -1 (no selection yet), go to first or last
    if (state.diffHunkIndex < 0) {
      idx = direction === 'next' ? 0 : hunks.length - 1;
    }
    if (idx === state.diffHunkIndex && state.diffHunkIndex >= 0) return;

    state.diffHunkIndex = idx;
    const hunk = hunks[idx];
    if (!hunk) return;

    // Find the DOM anchor and scroll to it
    const target = findHunkDomAnchor(hunk.anchorId, hunk.groupId);
    if (target) {
      // Calculate offset for sticky bars
      const barHeight = (document.getElementById('wysee-sync-bar')?.offsetHeight || 0)
        + (findBar && !findBar.classList.contains('is-hidden') ? findBar.offsetHeight : 0)
        + 16;
      const targetRect = target.getBoundingClientRect();
      const scrollTarget = window.scrollY + targetRect.top - barHeight;
      window.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
    }

    applyHunkFocusPulse(hunk);
    renderHunkGutterNav();

    // Sync peer pane
    setTimeout(() => {
      vscode.postMessage({ type: 'reportViewport', ratio: getViewportScrollMetrics().ratio });
    }, 350);
  }

  function findHunkDomAnchor(anchorId, groupId) {
    if (anchorId) {
      const el = document.getElementById(anchorId)
        || root.querySelector(`[data-wysee-block-id="${CSS.escape(anchorId)}"]`)
        || root.querySelector(`[data-wysee-diff-anchor="${CSS.escape(anchorId)}"]`);
      if (el) return el;
    }
    if (groupId) {
      return root.querySelector(`[data-wysee-diff-group-id="${CSS.escape(groupId)}"]`);
    }
    return null;
  }

  function applyHunkFocusPulse(hunk) {
    root.querySelectorAll('.wysee-hunk-focus-pulse').forEach((el) => {
      el.classList.remove('wysee-hunk-focus-pulse');
    });
    const groupId = hunk.groupId;
    if (!groupId) return;

    root.querySelectorAll(`[data-wysee-diff-group-id="${CSS.escape(groupId)}"]`).forEach((el) => {
      el.classList.add('wysee-hunk-focus-pulse');
    });

    setTimeout(() => {
      root.querySelectorAll('.wysee-hunk-focus-pulse').forEach((el) => {
        el.classList.remove('wysee-hunk-focus-pulse');
      });
    }, 900);
  }

  /** Inject or update the gutter navigator on the active hunk */
  function renderHunkGutterNav() {
    // Remove any existing gutter navs
    root.querySelectorAll('.wysee-hunk-nav').forEach((el) => el.remove());

    const hunks = state.diff?.hunks;
    if (!hunks || !hunks.length || state.diffHunkIndex < 0) return;

    const hunk = hunks[state.diffHunkIndex];
    if (!hunk) return;

    // Find the first element belonging to this hunk's group
    const groupId = hunk.groupId;
    if (!groupId) return;

    const firstGroupEl = root.querySelector(`[data-wysee-diff-group-id="${CSS.escape(groupId)}"]`)
      || findHunkDomAnchor(hunk.anchorId, groupId);
    if (!firstGroupEl) return;

    // Position: top-aligned with the first element in the hunk
    const rootRect = root.getBoundingClientRect();
    const targetRect = firstGroupEl.getBoundingClientRect();
    const navTop = targetRect.top - rootRect.top;

    // Build the gutter nav element (fixed height via CSS)
    const nav = document.createElement('div');
    nav.className = 'wysee-hunk-nav';
    nav.style.top = `${navTop}px`;
    nav.style.left = `0.1rem`;

    const prevBtn = document.createElement('button');
    prevBtn.className = 'wysee-hunk-nav-btn';
    prevBtn.dataset.wyseeHunkDir = 'prev';
    prevBtn.textContent = '▲';
    prevBtn.title = 'Previous change (Alt+Shift+Up)';
    if (state.diffHunkIndex <= 0) prevBtn.style.opacity = '0.3';

    const counter = document.createElement('span');
    counter.className = 'wysee-hunk-nav-counter';
    counter.textContent = `${state.diffHunkIndex + 1} / ${hunks.length}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'wysee-hunk-nav-btn';
    nextBtn.dataset.wyseeHunkDir = 'next';
    nextBtn.textContent = '▼';
    nextBtn.title = 'Next change (Alt+Shift+Down)';
    if (state.diffHunkIndex >= hunks.length - 1) nextBtn.style.opacity = '0.3';

    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);

    root.appendChild(nav);
  }

  /** Find the hunk index that owns a given blockId, or -1 */
  function findHunkIndexForBlock(blockId) {
    const hunks = state.diff?.hunks;
    const blocks = state.diff?.blocks;
    if (!hunks || !blocks) return -1;

    const blockInfo = blocks[blockId];
    if (!blockInfo || blockInfo.state === 'unchanged') return -1;

    const groupId = blockInfo.groupId;
    if (!groupId) return -1;

    return hunks.findIndex((h) => h.groupId === groupId);
  }

  // ── Collapse unchanged ──

  function toggleCollapseUnchanged() {
    state.diffCollapsed = !state.diffCollapsed;
    state.diffExpandedRuns = new Set();
    applyCollapseState();
  }

  function applyCollapseState() {
    // Remove existing collapse separators
    root.querySelectorAll('.wysee-unchanged-collapse').forEach((el) => el.remove());
    // Uncollapse everything first
    root.querySelectorAll('.is-collapsed-unchanged').forEach((el) => {
      el.classList.remove('is-collapsed-unchanged');
    });

    if (!state.diffCollapsed || !state.diff?.unchangedRuns) return;

    const CONTEXT = 2;

    for (const run of runs) {
      if (!run.collapsible) continue;
      if (state.diffExpandedRuns.has(run.id)) continue;

      const blockIds = run.blockIds;
      if (blockIds.length <= CONTEXT * 2) continue;

      const hideStart = CONTEXT;
      const hideEnd = blockIds.length - CONTEXT;
      const hiddenCount = hideEnd - hideStart;
      if (hiddenCount <= 0) continue;

      for (let bi = hideStart; bi < hideEnd; bi++) {
        const el = root.querySelector(`[data-wysee-block-id="${CSS.escape(blockIds[bi])}"]`);
        if (el) el.classList.add('is-collapsed-unchanged');
        // Also hide the boundary after the block
        if (el?.nextElementSibling?.classList.contains('wysee-boundary')) {
          el.nextElementSibling.classList.add('is-collapsed-unchanged');
        }
      }

      // Insert collapse separator after the last visible context block
      const lastContextEl = root.querySelector(`[data-wysee-block-id="${CSS.escape(blockIds[hideStart - 1])}"]`);
      if (lastContextEl) {
        const separator = document.createElement('div');
        separator.className = 'wysee-unchanged-collapse';
        separator.textContent = `··· ${hiddenCount} unchanged block${hiddenCount === 1 ? '' : 's'} hidden ···`;
        separator.dataset.wyseeCollapseRunId = run.id;
        separator.addEventListener('click', () => {
          state.diffExpandedRuns.add(run.id);
          applyCollapseState();
        });
        const insertRef = lastContextEl.nextElementSibling;
        if (insertRef) root.insertBefore(separator, insertRef.nextElementSibling || null);
        else root.appendChild(separator);
      }
    }
  }


  // ── Block binding ──
  function bindRoot() {
    root.querySelectorAll('[data-wysee-block-id]').forEach((el) => {
      el.addEventListener('click', (event) => {
        selectBlock(el.dataset.wyseeBlockId);
        vscode.postMessage({ type: 'focus', blockId: el.dataset.wyseeBlockId, blockKind: el.dataset.wyseeKind });
        vscode.postMessage({
          type: 'blockClicked',
          blockId: el.dataset.wyseeBlockId,
          startLine: Number(el.dataset.wyseeStartLine || 0),
          endLine: Number(el.dataset.wyseeEndLine || el.dataset.wyseeStartLine || 0),
        });
        // If this block belongs to a diff hunk, move the gutter nav to it
        if (state.diff?.hunks?.length) {
          const hunkIdx = findHunkIndexForBlock(el.dataset.wyseeBlockId);
          if (hunkIdx >= 0 && hunkIdx !== state.diffHunkIndex) {
            state.diffHunkIndex = hunkIdx;
            renderHunkGutterNav();
            applyHunkFocusPulse(state.diff.hunks[hunkIdx]);
          }
        }
        if (event.target.closest('a')) event.preventDefault();
      });
      el.addEventListener('dblclick', (event) => {
        if (!state.editable) return;
        if (event.target.closest('a')) event.preventDefault();
        openEditPanel(el);
      });
      el.addEventListener('mouseenter', () => {
        state.hoveredBlockId = el.dataset.wyseeBlockId;
        el.classList.add('is-hovered');
        const next = el.nextElementSibling;
        if (next && next.classList.contains('wysee-boundary')) next.classList.add('is-revealed');
      });
      el.addEventListener('mouseleave', () => {
        if (state.hoveredBlockId === el.dataset.wyseeBlockId) state.hoveredBlockId = undefined;
        el.classList.remove('is-hovered');
        const next = el.nextElementSibling;
        if (next && next.classList.contains('wysee-boundary')) next.classList.remove('is-revealed');
      });
    });
    root.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', (event) => {
        event.preventDefault();
        const href = a.getAttribute('href');
        if (href) vscode.postMessage({ type: 'openExternal', href });
      });
    });
  }

  // ── Boundaries ──
  function injectBoundaries() {
    root.querySelectorAll('.wysee-boundary').forEach((el) => el.remove());
    if (!state.editable) return;
    const blocks = [...root.querySelectorAll(':scope > .wysee-block')];
    const first = makeBoundary(null);
    first.classList.add('is-first');
    if (blocks.length > 0) root.insertBefore(first, blocks[0]);
    else root.appendChild(first);
    blocks.forEach((block) => {
      block.insertAdjacentElement('afterend', makeBoundary(block.dataset.wyseeBlockId));
    });
  }

  function makeBoundary(afterBlockId) {
    const boundary = document.createElement('div');
    boundary.className = 'wysee-boundary';
    boundary.setAttribute('aria-hidden', 'true');
    boundary.innerHTML = '<div class="wysee-boundary-line"></div>';
    const btn = document.createElement('button');
    btn.className = 'wysee-boundary-plus';
    btn.textContent = '+';
    btn.tabIndex = -1;
    btn.title = 'Insert new content here';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openInsertPanel(boundary, afterBlockId);
    });
    boundary.appendChild(btn);
    return boundary;
  }

  // ── Unified editor panel ──
  function buildPanel(initialMarkdown, onConfirm, onCancel, options = {}) {
    const panel = document.createElement('div');
    panel.className = 'wysee-editor-panel';
    const split = document.createElement('div');
    split.className = 'wysee-editor-split';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'wysee-editor-input-wrap';
    const gutter = document.createElement('div');
    gutter.className = 'wysee-editor-gutter';
    const textarea = document.createElement('textarea');
    textarea.value = initialMarkdown;
    textarea.setAttribute('spellcheck', 'true');
    inputWrap.appendChild(gutter);
    inputWrap.appendChild(textarea);

    const preview = document.createElement('div');
    preview.className = 'wysee-editor-preview';
    preview.innerHTML = '<span class="wysee-editor-preview-empty">Preview</span>';

    split.appendChild(inputWrap);
    split.appendChild(preview);
    panel.appendChild(split);

    const actions = document.createElement('div');
    actions.className = 'wysee-editor-actions';
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'confirm';
    confirmBtn.innerHTML = '&#10003; Confirm';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'cancel';
    cancelBtn.innerHTML = '&#10005; Cancel';
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = 'Ctrl/Cmd+Enter confirms · Esc cancels';
    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(hint);
    panel.appendChild(actions);

    function updateGutter() {
      const lineCount = textarea.value.split('\n').length;
      gutter.innerHTML = '';
      for (let i = 1; i <= lineCount; i += 1) {
        const s = document.createElement('span');
        s.textContent = String(i);
        gutter.appendChild(s);
      }
    }
    textarea.addEventListener('scroll', () => { gutter.scrollTop = textarea.scrollTop; });
    updateGutter();

    let previewTimer = null;
    function requestPreview() {
      const md = textarea.value;
      if (!md.trim()) {
        preview.innerHTML = '<span class="wysee-editor-preview-empty">Preview</span>';
        return;
      }
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        const reqId = 'p-' + Date.now() + '-' + Math.random().toString(16).slice(2);
        state.pendingPreviews[reqId] = async (html) => {
          preview.innerHTML = '<div class="wysee-block">' + html + '</div>';
          await hydrateContainerMermaid(preview);
          hydrateContainerKatex(preview);
        };
        vscode.postMessage({ type: 'requestPreview', markdown: md, requestId: reqId });
      }, 150);
    }
    textarea.addEventListener('input', () => {
      updateGutter();
      requestPreview();
    });
    if (initialMarkdown.trim()) setTimeout(requestPreview, 50);

    textarea.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = String(e.key || '').toLowerCase();
      if (mod && (key === 'z' || key === 'y')) {
        e.stopPropagation();
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        document.execCommand('insertText', false, '\t');
        updateGutter();
        requestPreview();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (mod && key === 'enter') {
        e.preventDefault();
        e.stopPropagation();
        onConfirm(textarea.value);
        return;
      }
      if (mod && key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        openFindBar(getSelectedTextareaText(textarea));
        return;
      }
      if (mod && key === 'b') {
        e.preventDefault();
        e.stopPropagation();
        applyShortcutToTextarea(textarea, 'bold');
        return;
      }
      if (mod && key === 'i') {
        e.preventDefault();
        e.stopPropagation();
        applyShortcutToTextarea(textarea, 'italic');
        return;
      }
      if (mod && key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        applyShortcutToTextarea(textarea, 'link');
        return;
      }
      if (mod) e.stopPropagation();
    });

    textarea.addEventListener('focus', () => {
      vscode.postMessage({ type: 'editPanelState', active: true, textareaFocused: true });
    });
    textarea.addEventListener('blur', () => {
      vscode.postMessage({ type: 'editPanelState', active: true, textareaFocused: false });
    });

    confirmBtn.addEventListener('click', () => onConfirm(textarea.value));
    cancelBtn.addEventListener('click', () => onCancel());

    if (typeof options.selectionStart === 'number' || typeof options.selectionEnd === 'number') {
      requestAnimationFrame(() => {
        focusTextareaSelection(textarea, options.selectionStart ?? 0, options.selectionEnd ?? options.selectionStart ?? 0);
      });
    }

    return { panel, textarea };
  }

  function openInsertPanel(boundary, afterBlockId) {
    closeActivePanel();
    boundary.classList.add('has-panel');
    const { panel, textarea } = buildPanel('', (md) => {
      if (md.trim()) vscode.postMessage({ type: 'insertAtBoundary', afterBlockId, markdown: md.trim() });
      closeActivePanel();
    }, () => closeActivePanel());
    boundary.appendChild(panel);
    state.activePanel = { el: panel, mode: 'insert', afterBlockId, boundary, textarea };
    vscode.postMessage({ type: 'editPanelState', active: true, textareaFocused: true });
    textarea.focus();
  }

  function openEditPanel(blockEl, options = {}) {
    closeActivePanel();
    const block = state.model?.blocks?.[blockEl.dataset.wyseeBlockId];
    if (!block) return null;

    const fnRefRegex = /\[\^([^\]]+)\]/g;
    let fnMatch;
    const referencedLabels = new Set();
    while ((fnMatch = fnRefRegex.exec(block.raw))) referencedLabels.add(fnMatch[1]);

    const fnDefBlocks = [];
    if (referencedLabels.size > 0 && state.model?.blocks) {
      for (const [id, b] of Object.entries(state.model.blocks)) {
        if (b.kind === 'footnoteDefinition') {
          const defMatch = b.raw.match(/^\[\^([^\]]+)\]:/);
          if (defMatch && referencedLabels.has(defMatch[1])) {
            fnDefBlocks.push({ label: defMatch[1], blockId: id, raw: b.raw });
          }
        }
      }
    }

    let initialText = block.raw;
    if (fnDefBlocks.length > 0) initialText += '\n\n' + fnDefBlocks.map((d) => d.raw).join('\n\n');

    const { panel, textarea } = buildPanel(initialText, (md) => {
      if (fnDefBlocks.length > 0 || /\[\^[^\]]+\]:\s/.test(md)) {
        const lines = md.split('\n');
        const mainLines = [];
        const defLines = [];
        let inDef = false;
        for (const line of lines) {
          if (/^\[\^[^\]]+\]:\s/.test(line)) inDef = true;
          else if (inDef && !line.trim()) inDef = false;
          (inDef || /^\[\^[^\]]+\]:\s/.test(line)) ? defLines.push(line) : mainLines.push(line);
        }
        while (mainLines.length && !mainLines[mainLines.length - 1].trim()) mainLines.pop();

        const parsedDefs = [];
        const defRegex = /^\[\^([^\]]+)\]:\s*.*$/gm;
        let dm;
        while ((dm = defRegex.exec(defLines.join('\n')))) {
          const label = dm[0].match(/^\[\^([^\]]+)\]/)[1];
          const existing = fnDefBlocks.find((d) => d.label === label);
          parsedDefs.push({ label, blockId: existing?.blockId ?? null, raw: dm[0] });
        }
        vscode.postMessage({
          type: 'editBlockWithFootnotes', blockId: block.blockId,
          documentVersion: state.model.version, mainContent: mainLines.join('\n'), footnoteDefs: parsedDefs,
        });
      } else {
        vscode.postMessage({
          type: 'editBlock',
          payload: { blockId: block.blockId, documentVersion: state.model.version, editKind: 'raw', value: md },
        });
      }
      closeActivePanel();
    }, () => closeActivePanel(), options);

    blockEl.style.display = 'none';
    blockEl.insertAdjacentElement('afterend', panel);
    state.activePanel = { el: panel, mode: 'edit', blockId: block.blockId, originalBlockEl: blockEl, textarea };
    vscode.postMessage({ type: 'editPanelState', active: true, textareaFocused: true });
    textarea.focus();
    refreshOpenFindResults({ preserveInputFocus: false });
    if (options.scrollIntoView) {
      requestAnimationFrame(() => {
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
    return state.activePanel;
  }

  function closeActivePanel() {
    if (!state.activePanel) return;
    const p = state.activePanel;
    p.el.remove();
    if (p.boundary) p.boundary.classList.remove('has-panel');
    if (p.originalBlockEl) p.originalBlockEl.style.display = '';
    state.activePanel = null;
    vscode.postMessage({ type: 'editPanelState', active: false });
    refreshOpenFindResults({ preserveInputFocus: false });
  }

  // ── Selection ──
  function restoreSelected() {
    if (!state.selectedBlockId) return;
    const el = root.querySelector(`[data-wysee-block-id="${CSS.escape(state.selectedBlockId)}"]`);
    if (el) el.classList.add('is-selected');
  }
  function selectBlock(blockId) {
    state.selectedBlockId = blockId;
    root.querySelectorAll('.wysee-block.is-selected').forEach((el) => el.classList.remove('is-selected'));
    const target = root.querySelector(`[data-wysee-block-id="${CSS.escape(blockId)}"]`);
    target?.classList.add('is-selected');
  }

  // ── Stats / issues ──
  function renderStatsSummary() {
    const stats = state.model?.stats;
    if (!wordCountEl) return;
    wordCountEl.textContent = `Word Count: ${stats?.wordCount ?? 0}`;
    if (moreStatsButton) {
      moreStatsButton.disabled = !stats;
    }
  }

  function rerenderOpenModal() {
    if (!state.modal) return;
    if (state.modal.kind === 'stats') {
      openStatsModal();
      return;
    }
    if (state.modal.kind === 'dangling') {
      openDanglingIssuesModal();
    }
  }

  function closeModal() {
    state.modal = null;
    overlayHost.classList.remove('has-modal');
    overlayHost.innerHTML = '';
  }

  function openStatsModal() {
    const stats = state.model?.stats;
    if (!stats) return;
    state.modal = { kind: 'stats' };
    overlayHost.classList.add('has-modal');
    overlayHost.innerHTML = renderModalHtml('Document Stats', buildStatsModalBody(stats));
  }

  function openDanglingIssuesModal() {
    const stats = state.model?.stats;
    if (!stats) return;
    state.modal = { kind: 'dangling' };
    overlayHost.classList.add('has-modal');
    overlayHost.innerHTML = renderModalHtml('Dangling References', buildDanglingIssuesBody(stats));
  }

  function renderModalHtml(title, bodyHtml) {
    return `
      <div class="wysee-modal-backdrop">
        <div class="wysee-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
          <div class="wysee-modal-header">
            <h2 class="wysee-modal-title">${escapeHtml(title)}</h2>
            <button type="button" class="wysee-modal-close" data-wysee-modal-close="true" aria-label="Close">×</button>
          </div>
          <div class="wysee-modal-body">${bodyHtml}</div>
        </div>
      </div>`;
  }

  function buildStatsModalBody(stats) {
    const rows = [
      statRow('Estimated reading time', `${stats.readingTimeMinutes} min`),
      statRow('Character count (plain text)', formatNumber(stats.characterCountPlainText)),
      statRow('Character count (no spaces)', formatNumber(stats.characterCountNoSpaces)),
      statRow('Character count (with markup)', formatNumber(stats.characterCountWithMarkup)),
      statRow('Paragraph count', formatNumber(stats.paragraphCount)),
      statRow('Table count', formatNumber(stats.tableCount)),
      statRow('Image count', formatNumber(stats.imageCount)),
      statRow('Diagram count', formatNumber(stats.diagramCount)),
      statRow(
        'Dangling References',
        `<button type="button" class="wysee-stat-value-button" data-wysee-modal-action="openDanglingIssues">${formatNumber(stats.danglingReferenceCount)}</button>`,
      ),
    ];
    if (stats.codeBlockLineCount > 0) {
      rows.splice(8, 0, statRow('Code block line count', formatNumber(stats.codeBlockLineCount)));
    }

    const sectionsHtml = stats.sections.length
      ? `<ul class="wysee-section-counts">${stats.sections.map((section) => `
          <li>
            <span class="wysee-section-count-heading">${escapeHtml(section.heading)} <span class="wysee-issue-meta">(H${section.level || 1}, line ${section.startLine + 1})</span></span>
            <span class="wysee-section-count-value">${formatNumber(section.wordCount)}</span>
          </li>`).join('')}
        </ul>`
      : '<p class="wysee-empty-state">No sections detected at the configured heading depth.</p>';

    return `
      <div class="wysee-stats-grid">${rows.join('')}</div>
      <div class="wysee-stats-section">
        <h3>Word count by section (H${stats.sectionDepth})</h3>
        ${sectionsHtml}
      </div>`;
  }

  function buildDanglingIssuesBody(stats) {
    if (!stats.danglingIssues.length) {
      return '<p class="wysee-empty-state">No dangling references found.</p>';
    }
    return `<ul class="wysee-issues-list">${stats.danglingIssues.map((issue) => `
      <li class="wysee-issue-item">
        <button type="button" class="wysee-issue-link" data-wysee-issue-id="${escapeHtml(issue.id)}">
          <span><strong>${escapeHtml(capitalize(issue.kind))}</strong> — ${escapeHtml(issue.message)}</span>
          <span class="wysee-issue-meta">Line ${issue.line + 1}</span>
          <span class="wysee-issue-snippet">${escapeHtml(issue.snippet || '(empty)')}</span>
        </button>
      </li>`).join('')}</ul>`;
  }

  function statRow(label, valueHtml) {
    return `
      <div class="wysee-stat-label">${escapeHtml(label)}</div>
      <div class="wysee-stat-value">${valueHtml}</div>`;
  }

  function navigateToIssue(issueId) {
    if (!issueId) return;
    const issue = state.model?.stats?.danglingIssues?.find((item) => item.id === issueId);
    if (!issue) return;
    closeModal();

    const blockEl = root.querySelector(`[data-wysee-block-id="${CSS.escape(issue.blockId)}"]`);
    if (!blockEl) return;

    selectBlock(issue.blockId);
    const startLine = Number(blockEl.dataset.wyseeStartLine || 0);
    const endLine = Number(blockEl.dataset.wyseeEndLine || startLine);
    vscode.postMessage({ type: 'blockClicked', blockId: issue.blockId, startLine, endLine });

    if (state.activePanel?.blockId === issue.blockId && state.activePanel?.textarea) {
      focusTextareaSelection(state.activePanel.textarea, issue.relativeStart, issue.relativeEnd);
      state.activePanel.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    openEditPanel(blockEl, {
      selectionStart: issue.relativeStart,
      selectionEnd: issue.relativeEnd,
      scrollIntoView: true,
    });
  }

  // ── Find ──
  function openFindBar(prefill) {
    if (!findBar || !findInput) return;
    findBar.classList.remove('is-hidden');
    syncFindUiState();
    syncFindControlAvailability(state.activePanel?.textarea ? 'textarea' : 'canvas');

    if (typeof prefill === 'string') {
      if (prefill) {
        findInput.value = prefill;
      }
    } else {
      const selected = getCurrentFindPrefill();
      if (selected && !findInput.value) {
        findInput.value = selected;
      }
    }

    if (!state.activePanel?.textarea) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
    }

    focusFindInput(true);
    if (findInput.value) {
      performFind('next', { resetFromInput: true, preserveInputFocus: true });
    } else {
      clearFindResults();
      updateFindStatus('');
    }
  }

  function closeFindBar() {
    if (!findBar || !findInput) return;
    const committed = commitFindSelectionOnClose();
    findBar.classList.add('is-hidden');
    clearFindResults();
    updateFindStatus('');
    if (committed) {
      findInput.blur?.();
      return;
    }
    if (state.activePanel?.textarea) {
      state.activePanel.textarea.focus();
    } else {
      root.focus?.();
    }
  }

  function refreshOpenFindResults(options = {}) {
    if (!findBar || findBar.classList.contains('is-hidden')) {
      return;
    }
    performFind(options.direction || 'next', { resetFromInput: true, preserveInputFocus: options.preserveInputFocus !== false, forceRebuild: true });
  }

  function syncFindUiState() {
    if (findHighlightAllCheckbox) {
      findHighlightAllCheckbox.checked = state.find.highlightAll;
    }
    if (findMatchCaseCheckbox) {
      findMatchCaseCheckbox.checked = state.find.matchCase;
    }
    if (findMatchMarkdownCheckbox) {
      findMatchMarkdownCheckbox.checked = state.find.matchMarkdown;
    }
  }

  function syncFindControlAvailability(mode) {
    const textareaMode = mode === 'textarea';
    if (findHighlightAllCheckbox) {
      findHighlightAllCheckbox.disabled = textareaMode;
      findHighlightAllCheckbox.title = textareaMode ? 'Highlight All is available in the canvas view.' : '';
    }
    if (findMatchMarkdownCheckbox) {
      findMatchMarkdownCheckbox.disabled = textareaMode;
      findMatchMarkdownCheckbox.title = textareaMode ? 'Edit panels already search source Markdown.' : '';
    }
  }

  function focusFindInput(selectAll) {
    if (!findInput || !findBar || findBar.classList.contains('is-hidden')) return;
    findInput.focus();
    if (selectAll) {
      findInput.select();
    }
  }

  function getCurrentFindPrefill() {
    if (state.activePanel?.textarea) {
      return getSelectedTextareaText(state.activePanel.textarea);
    }
    const selected = window.getSelection()?.toString();
    return selected ? selected.trim() : '';
  }

  function performFind(direction, options = {}) {
    const query = String(findInput?.value || '');
    if (!query) {
      clearFindResults();
      updateFindStatus('');
      state.find.lastQuery = '';
      state.find.lastMode = '';
      state.find.lastCriteriaKey = '';
      return false;
    }

    const mode = state.activePanel?.textarea ? 'textarea' : 'canvas';
    syncFindControlAvailability(mode);
    const criteriaKey = JSON.stringify({
      query,
      mode,
      matchCase: state.find.matchCase,
      matchMarkdown: mode === 'canvas' ? state.find.matchMarkdown : false,
    });
    const needsRebuild = Boolean(options.forceRebuild)
      || Boolean(options.resetFromInput)
      || state.find.lastCriteriaKey !== criteriaKey;

    state.find.lastQuery = query;
    state.find.lastMode = mode;
    state.find.lastCriteriaKey = criteriaKey;

    if (mode === 'textarea') {
      return performFindInTextarea(state.activePanel.textarea, query, direction, needsRebuild, options);
    }

    return performFindInCanvas(query, direction, needsRebuild, options);
  }

  function performFindInTextarea(textarea, query, direction, needsRebuild, options = {}) {
    clearCanvasFindHighlights();
    if (!textarea) {
      clearFindResults();
      updateFindStatus('No matches');
      return false;
    }

    if (needsRebuild) {
      const matches = findAllQueryMatches(textarea.value, query, state.find.matchCase).map((match) => ({
        kind: 'textarea',
        start: match.start,
        end: match.end,
      }));
      state.find.results = matches;
      state.find.activeIndex = matches.length ? (direction === 'previous' ? matches.length - 1 : 0) : -1;
    } else {
      state.find.activeIndex = stepFindIndex(state.find.activeIndex, state.find.results.length, direction);
    }

    const active = getActiveFindResult();
    if (!active) {
      updateFindStatus('No matches');
      return false;
    }

    textarea.focus();
    textarea.setSelectionRange(active.start, active.end);
    scrollTextareaSelectionIntoView(textarea, active.start);
    updateFindStatus(`${state.find.activeIndex + 1} of ${state.find.results.length}`);
    if (options.preserveInputFocus) {
      focusFindInput(false);
    }
    return true;
  }

  function performFindInCanvas(query, direction, needsRebuild, options = {}) {
    if (needsRebuild) {
      state.find.results = buildCanvasFindResults(query);
      state.find.activeIndex = state.find.results.length ? (direction === 'previous' ? state.find.results.length - 1 : 0) : -1;
    } else {
      state.find.activeIndex = stepFindIndex(state.find.activeIndex, state.find.results.length, direction);
    }

    renderCanvasFindHighlights();

    const active = getActiveFindResult();
    if (!active) {
      updateFindStatus('No matches');
      return false;
    }

    updateFindStatus(`${state.find.activeIndex + 1} of ${state.find.results.length}`);
    scrollFindResultIntoView(active, options.resetFromInput ? 'auto' : 'smooth');
    if (options.preserveInputFocus) {
      focusFindInput(false);
    }
    return true;
  }

  function stepFindIndex(currentIndex, total, direction) {
    if (!total) return -1;
    if (currentIndex < 0 || currentIndex >= total) {
      return direction === 'previous' ? total - 1 : 0;
    }
    return direction === 'previous'
      ? (currentIndex - 1 + total) % total
      : (currentIndex + 1) % total;
  }

  function getActiveFindResult() {
    if (!state.find.results.length || state.find.activeIndex < 0 || state.find.activeIndex >= state.find.results.length) {
      return null;
    }
    return state.find.results[state.find.activeIndex];
  }

  function clearFindResults() {
    state.find.results = [];
    state.find.activeIndex = -1;
    clearCanvasFindHighlights();
  }

  function findAllQueryMatches(text, query, matchCase) {
    if (!query) {
      return [];
    }
    const haystack = normalizeFindText(text, matchCase);
    const needle = normalizeFindText(query, matchCase);
    if (!needle) {
      return [];
    }
    const matches = [];
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) {
        break;
      }
      matches.push({ start: index, end: index + needle.length });
      from = index + Math.max(1, needle.length);
    }
    return matches;
  }

  function normalizeFindText(text, matchCase) {
    const normalized = String(text || '').replace(/\u00A0/g, ' ');
    return matchCase ? normalized : normalized.toLocaleLowerCase();
  }

  function scrollTextareaSelectionIntoView(textarea, start) {
    const value = textarea.value;
    const lineCount = Math.max(1, value.split('\n').length);
    const lineIndex = (value.slice(0, start).match(/\n/g) || []).length;
    textarea.scrollTop = textarea.scrollHeight * (lineIndex / lineCount);
  }

  function buildCanvasFindResults(query) {
    const results = [];
    const contexts = getCanvasSearchContexts();
    for (const context of contexts) {
      if (state.find.matchMarkdown) {
        for (const match of findAllQueryMatches(context.rawText, query, state.find.matchCase)) {
          const visibleSpan = mapRawMatchToVisibleSpan(context.rawToVisible, match.start, match.end);
          const range = visibleSpan ? buildRangeFromTextSegments(context.segments, visibleSpan.start, visibleSpan.end) : null;
          results.push({
            kind: 'canvas',
            mode: 'markdown',
            blockId: context.blockId,
            blockEl: context.blockEl,
            range,
            rawStart: match.start,
            rawEnd: match.end,
          });
        }
        continue;
      }

      for (const match of findAllQueryMatches(context.visibleText, query, state.find.matchCase)) {
        const range = buildRangeFromTextSegments(context.segments, match.start, match.end);
        if (!range) {
          continue;
        }
        results.push({
          kind: 'canvas',
          mode: 'plainText',
          blockId: context.blockId,
          blockEl: context.blockEl,
          range,
        });
      }
    }
    return results;
  }

  function getCanvasSearchContexts() {
    const blocks = [...root.querySelectorAll(':scope > [data-wysee-block-id]')];
    return blocks
      .filter((blockEl) => isFindSearchableBlock(blockEl))
      .map((blockEl) => buildCanvasSearchContext(blockEl))
      .filter((context) => context && ((state.find.matchMarkdown && context.rawText) || (!state.find.matchMarkdown && context.visibleText)));
  }

  function isFindSearchableBlock(blockEl) {
    if (!blockEl || blockEl.closest('.wysee-editor-panel')) {
      return false;
    }
    if (blockEl.dataset.wyseeKind === 'footnoteDefinition') {
      return false;
    }
    const style = window.getComputedStyle(blockEl);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function buildCanvasSearchContext(blockEl) {
    const blockId = blockEl.dataset.wyseeBlockId;
    const block = state.model?.blocks?.[blockId];
    if (!blockId || !block) {
      return null;
    }
    const segments = collectCanvasTextSegments(blockEl);
    const visibleText = segments.map((segment) => segment.text).join('').replace(/\u00A0/g, ' ');
    return {
      blockId,
      blockEl,
      rawText: String(block.raw || '').replace(/\u00A0/g, ' '),
      visibleText,
      segments,
      rawToVisible: buildRawToVisibleMap(String(block.raw || ''), visibleText),
    };
  }

  function collectCanvasTextSegments(blockEl) {
    const segments = [];
    let cursor = 0;
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.closest('.wysee-boundary, .wysee-editor-panel, .wysee-mermaid-source')) {
          return NodeFilter.FILTER_REJECT;
        }
        const style = window.getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const text = String(node.nodeValue || '');
      if (!text) {
        continue;
      }
      segments.push({
        node,
        text,
        start: cursor,
        end: cursor + text.length,
      });
      cursor += text.length;
    }
    return segments;
  }

  function buildRawToVisibleMap(rawText, visibleText) {
    const source = String(rawText || '').replace(/\u00A0/g, ' ');
    const visible = String(visibleText || '').replace(/\u00A0/g, ' ');
    const map = new Array(source.length).fill(-1);
    let visibleIndex = 0;

    for (let sourceIndex = 0; sourceIndex < source.length && visibleIndex < visible.length; sourceIndex += 1) {
      const sourceChar = source[sourceIndex];
      if (charsEquivalentForFind(sourceChar, visible[visibleIndex])) {
        map[sourceIndex] = visibleIndex;
        visibleIndex += 1;
        continue;
      }
      const lookahead = findNextEquivalentVisibleIndex(visible, visibleIndex + 1, sourceChar);
      if (lookahead >= 0) {
        visibleIndex = lookahead;
        map[sourceIndex] = visibleIndex;
        visibleIndex += 1;
      }
    }

    return map;
  }

  function charsEquivalentForFind(a, b) {
    if (a === b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    return /\s/.test(a) && /\s/.test(b);
  }

  function findNextEquivalentVisibleIndex(text, start, targetChar) {
    for (let index = start; index < text.length; index += 1) {
      if (charsEquivalentForFind(text[index], targetChar)) {
        return index;
      }
    }
    return -1;
  }

  function mapRawMatchToVisibleSpan(rawToVisible, start, end) {
    let visibleStart = Number.POSITIVE_INFINITY;
    let visibleEnd = -1;
    for (let index = start; index < end; index += 1) {
      const mapped = rawToVisible[index];
      if (typeof mapped !== 'number' || mapped < 0) {
        continue;
      }
      visibleStart = Math.min(visibleStart, mapped);
      visibleEnd = Math.max(visibleEnd, mapped + 1);
    }
    if (!Number.isFinite(visibleStart) || visibleEnd < 0) {
      return null;
    }
    return { start: visibleStart, end: visibleEnd };
  }

  function buildRangeFromTextSegments(segments, start, end) {
    if (!segments.length || start >= end) {
      return null;
    }
    const startRef = locateSegmentOffset(segments, start, false);
    const endRef = locateSegmentOffset(segments, end, true);
    if (!startRef || !endRef) {
      return null;
    }
    try {
      const range = document.createRange();
      range.setStart(startRef.node, startRef.offset);
      range.setEnd(endRef.node, endRef.offset);
      return range;
    } catch {
      return null;
    }
  }

  function locateSegmentOffset(segments, absoluteOffset, isEnd) {
    const last = segments[segments.length - 1];
    if (!last) {
      return null;
    }
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (!isEnd && absoluteOffset >= segment.start && absoluteOffset < segment.end) {
        return { node: segment.node, offset: absoluteOffset - segment.start };
      }
      if (!isEnd && absoluteOffset === segment.end && segments[index + 1]) {
        return { node: segments[index + 1].node, offset: 0 };
      }
      if (isEnd && absoluteOffset > segment.start && absoluteOffset <= segment.end) {
        return { node: segment.node, offset: absoluteOffset - segment.start };
      }
      if (isEnd && absoluteOffset === segment.start) {
        return { node: segment.node, offset: 0 };
      }
    }
    if (absoluteOffset === last.end) {
      return { node: last.node, offset: String(last.node.nodeValue || '').length };
    }
    return null;
  }

  function ensureFindOverlayLayer() {
    if (state.find.overlayLayer && document.body.contains(state.find.overlayLayer)) {
      return state.find.overlayLayer;
    }
    const layer = document.createElement('div');
    layer.className = 'wysee-find-highlight-layer';
    document.body.appendChild(layer);
    state.find.overlayLayer = layer;
    return layer;
  }

  function clearCanvasFindHighlights() {
    root.classList.remove('has-find-results');
    if (state.find.overlayLayer) {
      state.find.overlayLayer.innerHTML = '';
      state.find.overlayLayer.style.height = '0px';
    }
  }

  function renderCanvasFindHighlights() {
    clearCanvasFindHighlights();
    if (state.find.lastMode !== 'canvas' || !state.find.results.length) {
      root.classList.remove('has-find-results');
      return;
    }
    const active = getActiveFindResult();
    if (!active) {
      root.classList.remove('has-find-results');
      return;
    }

    /* Suppress native browser selection so it doesn't overlap the find overlay */
    root.classList.add('has-find-results');
    const nativeSel = window.getSelection();
    if (nativeSel && !nativeSel.isCollapsed) {
      nativeSel.removeAllRanges();
    }

    const layer = ensureFindOverlayLayer();
    layer.style.height = `${Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)}px`;
    const items = state.find.highlightAll
      ? state.find.results.map((result, index) => ({ result, active: index === state.find.activeIndex }))
      : [{ result: active, active: true }];

    for (const item of items) {
      const rects = getFindResultRects(item.result);
      for (const rect of rects) {
        if (!rect.width && !rect.height) {
          continue;
        }
        const highlight = document.createElement('div');
        highlight.className = `wysee-find-hit${item.active ? ' is-active' : ''}${item.result.range ? '' : ' is-block'}`;
        highlight.style.left = `${rect.left + window.scrollX}px`;
        highlight.style.top = `${rect.top + window.scrollY}px`;
        highlight.style.width = `${Math.max(2, rect.width)}px`;
        highlight.style.height = `${Math.max(2, rect.height)}px`;
        layer.appendChild(highlight);
      }
    }
  }

  function getFindResultRects(result) {
    if (result?.range) {
      const rects = [...result.range.getClientRects()].filter((rect) => rect.width || rect.height);
      if (rects.length) {
        return rects;
      }
      const rangeRect = result.range.getBoundingClientRect();
      if (rangeRect.width || rangeRect.height) {
        return [rangeRect];
      }
    }
    const blockRect = result?.blockEl?.getBoundingClientRect();
    return blockRect && (blockRect.width || blockRect.height) ? [blockRect] : [];
  }

  function getPrimaryFindResultRect(result) {
    if (result?.range) {
      const rangeRect = result.range.getBoundingClientRect();
      if (rangeRect.width || rangeRect.height) {
        return rangeRect;
      }
    }
    const rects = getFindResultRects(result);
    return rects.length ? rects[0] : null;
  }

  function scrollFindResultIntoView(result, behavior) {
    const rect = getPrimaryFindResultRect(result);
    if (!rect) {
      return;
    }
    const topPadding = (document.getElementById('wysee-sync-bar')?.offsetHeight || 0)
      + (findBar && !findBar.classList.contains('is-hidden') ? findBar.offsetHeight : 0)
      + 18;
    const bottomPadding = 24;
    if (rect.top >= topPadding && rect.bottom <= window.innerHeight - bottomPadding) {
      return;
    }
    const targetTop = Math.max(0, window.scrollY + rect.top - Math.max(topPadding, Math.round((window.innerHeight - rect.height) / 3)));
    window.scrollTo({ top: targetTop, behavior });
  }

  function commitFindSelectionOnClose() {
    if (state.find.lastMode === 'textarea') {
      if (state.activePanel?.textarea && getActiveFindResult()) {
        state.activePanel.textarea.focus();
        return true;
      }
      return false;
    }

    const active = getActiveFindResult();
    if (!active) {
      return false;
    }

    const query = String(findInput?.value || '');
    const preferSourceSelection = Boolean(state.find.matchMarkdown && (looksLikeMarkdownQuery(query) || !active.range));
    if (preferSourceSelection && typeof active.rawStart === 'number' && typeof active.rawEnd === 'number') {
      return openFindResultInEditPanel(active);
    }

    if (active.range) {
      const selection = window.getSelection();
      if (!selection) {
        return false;
      }
      selection.removeAllRanges();
      selection.addRange(active.range.cloneRange());
      scrollFindResultIntoView(active, 'smooth');
      return true;
    }

    if (typeof active.rawStart === 'number' && typeof active.rawEnd === 'number') {
      return openFindResultInEditPanel(active);
    }

    return false;
  }

  function looksLikeMarkdownQuery(query) {
    return /[*_`~\[\]()!#>|]/.test(query);
  }

  function openFindResultInEditPanel(result) {
    if (!result) {
      return false;
    }
    if (state.activePanel?.blockId === result.blockId && state.activePanel?.textarea) {
      focusTextareaSelection(state.activePanel.textarea, result.rawStart, result.rawEnd);
      state.activePanel.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    const blockEl = root.querySelector(`[data-wysee-block-id="${CSS.escape(result.blockId)}"]`);
    if (!blockEl) {
      return false;
    }
    return Boolean(openEditPanel(blockEl, {
      selectionStart: result.rawStart,
      selectionEnd: result.rawEnd,
      scrollIntoView: true,
    }));
  }

  function updateFindStatus(message) {
    if (findStatus) {
      findStatus.textContent = message;
    }
  }

  window.addEventListener('resize', () => {
    renderCanvasFindHighlights();
  }, { passive: true });

  // ── Formatting shortcuts ──
  function applyShortcutToTextarea(textarea, kind) {
    const shortcuts = window.WyseeEditorShortcuts;
    if (!shortcuts) {
      return false;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    let result;
    if (kind === 'bold') {
      result = shortcuts.toggleBold(textarea.value, start, end);
    } else if (kind === 'italic') {
      result = shortcuts.toggleItalic(textarea.value, start, end);
    } else if (kind === 'link') {
      result = shortcuts.toggleLink(textarea.value, start, end, 'url');
    }
    if (!result || !result.changed) {
      return false;
    }
    textarea.value = result.text;
    textarea.focus();
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function getSelectedTextareaText(textarea) {
    if (!textarea) return '';
    const start = Math.min(textarea.selectionStart, textarea.selectionEnd);
    const end = Math.max(textarea.selectionStart, textarea.selectionEnd);
    return textarea.value.slice(start, end).trim();
  }

  function focusTextareaSelection(textarea, start, end) {
    if (!textarea) return;
    const max = textarea.value.length;
    const clampedStart = Math.max(0, Math.min(max, start ?? 0));
    const clampedEnd = Math.max(clampedStart, Math.min(max, end ?? clampedStart));
    textarea.focus();
    textarea.setSelectionRange(clampedStart, clampedEnd);
  }

  // ── Mermaid / KaTeX hydration ──
  let mermaidRenderCount = 0;
  async function hydrateMermaid(retryCount = 0) {
    if (!state.model) return;
    if (!state.mermaidReady) {
      state.mermaidReady = loadScript(window.__WYSEE_MERMAID_URI__).then(() => {
        if (window.mermaid) window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
      });
    }
    await state.mermaidReady;
    if (!window.mermaid) return;
    const elements = [...root.querySelectorAll('.wysee-mermaid')];
    let anyFailed = false;
    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i];
      const source = el.getAttribute('data-wysee-mermaid-source') || '';
      if (!source.trim()) continue;
      if (el.querySelector('svg')) continue;
      const uniqueId = 'wysee-mermaid-' + (++mermaidRenderCount);
      try {
        const r = await window.mermaid.render(uniqueId, source);
        el.innerHTML = r.svg;
      } catch (err) {
        anyFailed = true;
        if (retryCount < 2) {
          el.innerHTML = '';
        } else {
          el.innerHTML = '<pre class="wysee-mermaid-error">' + escapeHtml(String(err)) + '</pre>';
        }
      }
    }
    if (anyFailed && retryCount < 2) {
      await new Promise((r) => setTimeout(r, 300));
      await hydrateMermaid(retryCount + 1);
    }
  }
  async function hydrateKatex() {
    if (!state.model) return;
    const elements = [...root.querySelectorAll('.wysee-math')];
    if (!elements.length) return;
    if (!state.katexReady) {
      state.katexReady = loadScript(window.__WYSEE_KATEX_URI__).catch(() => console.warn('KaTeX failed to load'));
    }
    await state.katexReady;
    if (!window.katex) return;
    for (const el of elements) {
      const src = el.getAttribute('data-wysee-math-source') || '';
      const dm = el.getAttribute('data-wysee-math-display') === 'block';
      if (!src.trim()) continue;
      try {
        el.innerHTML = window.katex.renderToString(src, { displayMode: dm, throwOnError: false, output: 'html' });
      } catch (err) {
        el.innerHTML = '<span class="wysee-math-error">' + escapeHtml(String(err)) + '</span>';
      }
    }
  }
  async function hydrateContainerMermaid(container) {
    if (!state.mermaidReady) return;
    await state.mermaidReady;
    if (!window.mermaid) return;
    const els = [...container.querySelectorAll('.wysee-mermaid')];
    for (let i = 0; i < els.length; i += 1) {
      const el = els[i];
      const src = el.getAttribute('data-wysee-mermaid-source') || '';
      if (!src.trim()) continue;
      try {
        const r = await window.mermaid.render('wysee-prev-' + Date.now() + '-' + i, src);
        el.innerHTML = r.svg;
      } catch (err) {
        el.innerHTML = '<pre class="wysee-mermaid-error">' + escapeHtml(String(err)) + '</pre>';
      }
    }
  }
  function hydrateContainerKatex(container) {
    if (!window.katex) return;
    for (const el of container.querySelectorAll('.wysee-math')) {
      const src = el.getAttribute('data-wysee-math-source') || '';
      const dm = el.getAttribute('data-wysee-math-display') === 'block';
      if (!src.trim()) continue;
      try {
        el.innerHTML = window.katex.renderToString(src, { displayMode: dm, throwOnError: false, output: 'html' });
      } catch (err) {
        el.innerHTML = '<span class="wysee-math-error">' + escapeHtml(String(err)) + '</span>';
      }
    }
  }

  // ── Helpers ──
  function extractContextWord(target) {
    const spell = target?.closest?.('[data-wysee-word]');
    if (spell) return spell.getAttribute('data-wysee-word');
    const text = window.getSelection()?.toString().trim();
    return text || undefined;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function capitalize(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function escapeHtml(v) {
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  vscode.postMessage({ type: 'ready' });
})();
