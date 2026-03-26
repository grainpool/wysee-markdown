(() => {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('wysee-root');
  const overlayHost = document.getElementById('wysee-overlay-host');
  const syncCheckbox = document.getElementById('wysee-sync-scroll');
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
    activePanel: null, // { el, mode, blockId?, afterBlockId?, boundary?, originalBlockEl?, textarea? }
  };

  // ── Sync scroll ──
  syncCheckbox?.addEventListener('change', () => {
    state.syncScroll = syncCheckbox.checked;
    vscode.postMessage({ type: 'syncScrollChanged', enabled: state.syncScroll });
  });

  // ── Scroll sync (block-anchor mapping with directional locking) ──
  // Maps scroll positions through block anchors so that a 400px mermaid diagram
  // (covering 10 source lines) scrolls proportionally through those 10 lines,
  // not proportionally through the whole document height.
  let scrollDriver = 'none'; // 'webview' | 'source' | 'none'
  let scrollDriverTimer = null;

  function claimScrollDriver(who) {
    scrollDriver = who;
    clearTimeout(scrollDriverTimer);
    scrollDriverTimer = setTimeout(() => { scrollDriver = 'none'; }, 500);
  }

  // Compute the fractional source line at the viewport top using block anchors
  function getSourceLineAtViewportTop() {
    const blocks = [...root.querySelectorAll(':scope > [data-wysee-block-id][data-wysee-start-line]')];
    if (!blocks.length) return 0;
    const viewTop = window.scrollY + 60; // offset for sync bar
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

  let scrollReportTimer = null;
  let lastReportedLine = -1;

  function reportScroll() {
    if (!state.syncScroll || !state.model) return;
    if (scrollDriver === 'source') return;
    claimScrollDriver('webview');
    clearTimeout(scrollReportTimer);
    scrollReportTimer = setTimeout(() => {
      const line = getSourceLineAtViewportTop();
      if (Math.abs(line - lastReportedLine) < 0.3) return;
      lastReportedLine = line;
      vscode.postMessage({ type: 'scrollSourceLine', line });
    }, 50);
  }
  window.addEventListener('scroll', reportScroll, { passive: true });

  // ── Copy / Cut / Paste interception ──
  document.addEventListener('copy', (e) => {
    // Allow native copy inside panel textarea
    if (isInPanelTextarea()) return;
    e.preventDefault();
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed && selection.toString().trim();

    if (hasSelection) {
      if (state.copyMode === 'sourceMarkdown') {
        const blockEls = getBlocksInSelection(selection);
        const rawParts = blockEls.map(el => state.model?.blocks?.[el.dataset.wyseeBlockId]?.raw).filter(Boolean);
        e.clipboardData.setData('text/plain', rawParts.join('\n\n'));
      } else {
        const range = selection.getRangeAt(0);
        const fragment = range.cloneContents();
        fragment.querySelectorAll('.wysee-boundary').forEach(el => el.remove());
        const temp = document.createElement('div');
        temp.appendChild(fragment);
        e.clipboardData.setData('text/plain', temp.innerText.replace(/\n{3,}/g, '\n\n').trim());
      }
    } else if (state.hoveredBlockId) {
      // No drag selection: copy the hovered block
      const block = state.model?.blocks?.[state.hoveredBlockId];
      if (block) {
        e.clipboardData.setData('text/plain', state.copyMode === 'sourceMarkdown' ? block.raw : block.plainText || block.raw);
      }
    }
  });

  document.addEventListener('cut', (e) => {
    if (!isInPanelTextarea()) { e.preventDefault(); }
  });

  document.addEventListener('paste', (e) => {
    if (!isInPanelTextarea()) { e.preventDefault(); }
  });

  // Ctrl+Z / Ctrl+Y handling:
  // - No panel open: send undo/redo to extension (webview is an iframe, keys don't reach VS Code)
  // - Panel open, in textarea: let browser handle native undo/redo
  // - Panel open, NOT in textarea: block (prevent accidental doc undo)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
      if (!state.activePanel) {
        // No panel open: forward to extension to execute VS Code's undo/redo
        e.preventDefault();
        e.stopPropagation();
        const isRedo = e.key === 'y' || e.key === 'Y' || e.shiftKey;
        vscode.postMessage({ type: isRedo ? 'redo' : 'undo' });
      } else if (!isInPanelTextarea()) {
        // Panel open but not in textarea: block entirely
        e.preventDefault();
        e.stopPropagation();
      }
      // else: in panel textarea, let browser handle natively
    }
  }, true);

  function isInPanelTextarea() {
    const active = document.activeElement;
    return active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') && active.closest('.wysee-editor-panel');
  }

  function getBlocksInSelection(selection) {
    const range = selection.getRangeAt(0);
    return [...root.querySelectorAll('[data-wysee-block-id]')].filter(el => range.intersectsNode(el));
  }

  // ── Context menu (right-click) — document-level ──
  root.addEventListener('contextmenu', (event) => {
    const target = event.target;

    // If panel is open and right-click is in the panel textarea, allow insert
    if (state.activePanel) {
      if (target.closest('.wysee-editor-input-wrap textarea')) {
        // Textarea inside edit panel — mark as insertable
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
      // Panel is open but click is NOT in textarea — block insertion
      vscode.postMessage({
        type: 'context', canInsertBlock: false,
        hasSelection: Boolean(window.getSelection()?.toString()),
        selectionText: window.getSelection()?.toString() || undefined,
      });
      return;
    }

    // Find which block the right-click is on
    const blockEl = target.closest?.('[data-wysee-block-id]');

    if (blockEl) {
      // Right-click on a block: normal context with block info
      const word = extractContextWord(target);
      vscode.postMessage({
        type: 'context',
        blockId: blockEl.dataset.wyseeBlockId,
        blockKind: blockEl.dataset.wyseeKind,
        word,
        hasSelection: Boolean(window.getSelection()?.toString()),
        selectionText: window.getSelection()?.toString() || undefined,
        canInsertBlock: true,
        // insertAfterBlockId will be resolved by the extension using the setting
      });
      return;
    }

    // Right-click in void area (not on a block)
    // Find the nearest block above the click point
    const clickY = event.clientY;
    const allBlocks = [...root.querySelectorAll(':scope > [data-wysee-block-id]')];
    let insertAfterBlockId = null;
    for (const b of allBlocks) {
      const rect = b.getBoundingClientRect();
      if (rect.bottom <= clickY) {
        // Skip footnote blocks for insertion purposes
        if (b.dataset.wyseeKind !== 'footnotes' && b.dataset.wyseeKind !== 'footnoteDefinition') {
          insertAfterBlockId = b.dataset.wyseeBlockId;
        }
      }
    }

    vscode.postMessage({
      type: 'context',
      canInsertBlock: true,
      insertAfterBlockId: insertAfterBlockId,
      hasSelection: Boolean(window.getSelection()?.toString()),
      selectionText: window.getSelection()?.toString() || undefined,
    });
  });

  // ── Message handling ──
  window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (msg.type === 'render') {
      state.model = msg.model;
      state.editable = Boolean(msg.model.editable);
      state.copyMode = msg.model.copyMode || 'plainText';
      themeStyle.textContent = `${msg.model.previewCss}\n${msg.model.pageCss || ''}\n${msg.model.syntaxCss || ''}`;
      root.innerHTML = msg.model.html;
      bindRoot();
      injectBoundaries();
      // Delay hydration to ensure DOM is painted (critical for mermaid on first load)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await hydrateMermaid();
      await hydrateKatex();
      restoreSelected();
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
      // Source is driving — use block-anchor mapping to scroll webview
      if (scrollDriver === 'webview') return;
      claimScrollDriver('source');
      scrollWebviewToSourceLine(msg.line);
      return;
    }
    if (msg.type === 'scrollToBlock') {
      // Explicit block scroll (from blockClicked) — always honor
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
      // Insert template text at cursor in the active panel textarea (undoable)
      if (state.activePanel?.textarea) {
        const ta = state.activePanel.textarea;
        ta.focus();
        ta.setSelectionRange(ta.selectionStart, ta.selectionEnd);
        document.execCommand('insertText', false, msg.text);
        ta.dispatchEvent(new Event('input'));
      }
      return;
    }
  });

  // ── Block binding ──
  function bindRoot() {
    root.querySelectorAll('[data-wysee-block-id]').forEach((el) => {
      el.addEventListener('click', (event) => {
        selectBlock(el.dataset.wyseeBlockId);
        vscode.postMessage({ type: 'focus', blockId: el.dataset.wyseeBlockId, blockKind: el.dataset.wyseeKind });
        vscode.postMessage({ type: 'blockClicked', blockId: el.dataset.wyseeBlockId, startLine: Number(el.dataset.wyseeStartLine || 0), endLine: Number(el.dataset.wyseeEndLine || el.dataset.wyseeStartLine || 0) });
        if (event.target.closest('a')) event.preventDefault();
      });
      el.addEventListener('dblclick', (event) => {
        if (!state.editable) return;
        if (event.target.closest('a')) event.preventDefault();
        openEditPanel(el);
      });
      // Hover indication: show block bounds + reveal boundary (+) below
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
    document.addEventListener('selectionchange', () => {
      const text = window.getSelection()?.toString() || '';
      vscode.postMessage({ type: 'selection', hasSelection: Boolean(text), selectionText: text || undefined });
    });
  }

  // ── Boundaries ──
  function injectBoundaries() {
    root.querySelectorAll('.wysee-boundary').forEach(el => el.remove());
    const blocks = [...root.querySelectorAll(':scope > .wysee-block')];
    const first = makeBoundary(null);
    first.classList.add('is-first');
    if (blocks.length > 0) root.insertBefore(first, blocks[0]);
    else root.appendChild(first);
    blocks.forEach(block => {
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
    btn.addEventListener('click', (e) => { e.stopPropagation(); openInsertPanel(boundary, afterBlockId); });
    boundary.appendChild(btn);
    return boundary;
  }

  // ── Unified editor panel ──
  function buildPanel(initialMarkdown, onConfirm, onCancel) {
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
    hint.textContent = 'Ctrl/Cmd+Enter confirms \u00b7 Esc cancels';
    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(hint);
    panel.appendChild(actions);

    function updateGutter() {
      const lineCount = textarea.value.split('\n').length;
      gutter.innerHTML = '';
      for (let i = 1; i <= lineCount; i++) {
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
      if (!md.trim()) { preview.innerHTML = '<span class="wysee-editor-preview-empty">Preview</span>'; return; }
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
    textarea.addEventListener('input', () => { updateGutter(); requestPreview(); });
    if (initialMarkdown.trim()) setTimeout(requestPreview, 50);

    textarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        e.stopPropagation(); return; // native undo/redo in textarea
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault(); e.stopPropagation();
        document.execCommand('insertText', false, '\t');
        updateGutter(); requestPreview(); return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onConfirm(textarea.value); return; }
      if (e.ctrlKey || e.metaKey) e.stopPropagation();
    });

    // Notify extension of panel textarea focus state
    textarea.addEventListener('focus', () => {
      vscode.postMessage({ type: 'editPanelState', active: true, textareaFocused: true });
    });
    textarea.addEventListener('blur', () => {
      vscode.postMessage({ type: 'editPanelState', active: true, textareaFocused: false });
    });

    confirmBtn.addEventListener('click', () => onConfirm(textarea.value));
    cancelBtn.addEventListener('click', () => onCancel());

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

  function openEditPanel(blockEl) {
    closeActivePanel();
    const block = state.model?.blocks?.[blockEl.dataset.wyseeBlockId];
    if (!block) return;

    // Collect footnote refs and their definitions
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
    if (fnDefBlocks.length > 0) initialText += '\n\n' + fnDefBlocks.map(d => d.raw).join('\n\n');

    const { panel, textarea } = buildPanel(initialText, (md) => {
      if (fnDefBlocks.length > 0 || /\[\^[^\]]+\]:\s/.test(md)) {
        const lines = md.split('\n');
        const mainLines = [], defLines = [];
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
          const existing = fnDefBlocks.find(d => d.label === label);
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
    }, () => closeActivePanel());

    blockEl.style.display = 'none';
    blockEl.insertAdjacentElement('afterend', panel);
    state.activePanel = { el: panel, mode: 'edit', blockId: block.blockId, originalBlockEl: blockEl, textarea };
    vscode.postMessage({ type: 'editPanelState', active: true, textareaFocused: true });
    textarea.focus();
  }

  function closeActivePanel() {
    if (!state.activePanel) return;
    const p = state.activePanel;
    p.el.remove();
    if (p.boundary) p.boundary.classList.remove('has-panel');
    if (p.originalBlockEl) p.originalBlockEl.style.display = '';
    state.activePanel = null;
    vscode.postMessage({ type: 'editPanelState', active: false });
  }

  // ── Selection ──
  function restoreSelected() {
    if (!state.selectedBlockId) return;
    const el = root.querySelector(`[data-wysee-block-id="${CSS.escape(state.selectedBlockId)}"]`);
    if (el) el.classList.add('is-selected');
  }
  function selectBlock(blockId) {
    state.selectedBlockId = blockId;
    root.querySelectorAll('.wysee-block.is-selected').forEach(el => el.classList.remove('is-selected'));
    const target = root.querySelector(`[data-wysee-block-id="${CSS.escape(blockId)}"]`);
    target?.classList.add('is-selected');
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
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i], source = el.getAttribute('data-wysee-mermaid-source') || '';
      if (!source.trim()) continue;
      if (el.querySelector('svg')) continue; // already rendered
      const uniqueId = 'wysee-mermaid-' + (++mermaidRenderCount);
      try {
        const r = await window.mermaid.render(uniqueId, source);
        el.innerHTML = r.svg;
      } catch (err) {
        anyFailed = true;
        if (retryCount < 2) {
          // Will retry after delay
          el.innerHTML = '';
        } else {
          el.innerHTML = '<pre class="wysee-mermaid-error">' + escapeHtml(String(err)) + '</pre>';
        }
      }
    }
    // Retry once if any failed (handles first-load timing issues)
    if (anyFailed && retryCount < 2) {
      await new Promise(r => setTimeout(r, 300));
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
      try { el.innerHTML = window.katex.renderToString(src, { displayMode: dm, throwOnError: false, output: 'html' }); }
      catch (err) { el.innerHTML = '<span class="wysee-math-error">' + escapeHtml(String(err)) + '</span>'; }
    }
  }
  async function hydrateContainerMermaid(container) {
    if (!state.mermaidReady) return;
    await state.mermaidReady;
    if (!window.mermaid) return;
    const els = [...container.querySelectorAll('.wysee-mermaid')];
    for (let i = 0; i < els.length; i++) {
      const el = els[i], src = el.getAttribute('data-wysee-mermaid-source') || '';
      if (!src.trim()) continue;
      try { const r = await window.mermaid.render('wysee-prev-' + Date.now() + '-' + i, src); el.innerHTML = r.svg; }
      catch (err) { el.innerHTML = '<pre class="wysee-mermaid-error">' + escapeHtml(String(err)) + '</pre>'; }
    }
  }
  function hydrateContainerKatex(container) {
    if (!window.katex) return;
    for (const el of container.querySelectorAll('.wysee-math')) {
      const src = el.getAttribute('data-wysee-math-source') || '';
      const dm = el.getAttribute('data-wysee-math-display') === 'block';
      if (!src.trim()) continue;
      try { el.innerHTML = window.katex.renderToString(src, { displayMode: dm, throwOnError: false, output: 'html' }); }
      catch (err) { el.innerHTML = '<span class="wysee-math-error">' + escapeHtml(String(err)) + '</span>'; }
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
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script'); s.src = src; s.onload = () => resolve(); s.onerror = reject; document.head.appendChild(s);
    });
  }
  function escapeHtml(v) {
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  vscode.postMessage({ type: 'ready' });
})();
