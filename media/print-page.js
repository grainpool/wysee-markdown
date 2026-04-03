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
  const printButton = document.getElementById('wysee-print-now');
  const beaconUrl = 'beacon';
  const autoPrint = true;

  function beacon(payload) {
    try {
      navigator.sendBeacon?.(beaconUrl, JSON.stringify(payload)) || fetch(beaconUrl, { method: 'POST', body: JSON.stringify(payload), keepalive: true });
    } catch (error) {
      console.warn('Wysee beacon failed', error);
    }
  }

  async function hydrateMermaid() {
    if (!window.mermaid) return;
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const elements = [...document.querySelectorAll('.wysee-mermaid')];
    for (let i = 0; i < elements.length; i += 1) {
      const el = elements[i];
      const source = el.getAttribute('data-wysee-mermaid-source') || '';
      if (!source.trim()) continue;
      try {
        const result = await window.mermaid.render(`wysee-print-mermaid-${i}`, source);
        el.innerHTML = result.svg;
      } catch (error) {
        el.innerHTML = `<pre>${String(error)}</pre>`;
      }
    }
  }

  async function waitForImages() {
    await Promise.all([...document.images].map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = img.onerror = resolve; })));
  }

  async function hydrateKatex() {
    if (!window.katex) return;
    const elements = [...document.querySelectorAll('.wysee-math')];
    for (const el of elements) {
      const source = el.getAttribute('data-wysee-math-source') || '';
      const displayMode = el.getAttribute('data-wysee-math-display') === 'block';
      if (!source.trim()) continue;
      try {
        el.innerHTML = window.katex.renderToString(source, { displayMode, throwOnError: false, output: 'html' });
      } catch (error) {
        el.innerHTML = `<span>${String(error)}</span>`;
      }
    }
  }

  function setupPageNumbers() {
    const config = window.__WYSEE_PAGE_NUMBERS__;
    if (!config || !config.enabled) return;
    const el = document.getElementById('wysee-page-num');
    if (!el) return;
    // The fixed-position footer repeats on every printed page in Chromium.
    // CSS counters can't provide per-page numbers outside @page margin boxes,
    // so we set a label and rely on the browser's own page counter when
    // "Headers and footers" is enabled in the print dialog for actual numbering.
    // Firefox supports @page margin boxes natively and will use those instead.
    const startAt = config.startAt ?? 1;
    el.textContent = '';
    el.setAttribute('data-wysee-page-start', String(startAt));

    // Remove the suppress-first-page class right before print so the footer
    // appears on subsequent pages (the class hides it on load for first-page suppression)
    if (config.suppressFirstPage) {
      window.addEventListener('afterprint', () => {
        document.body.classList.add('wysee-suppress-first-page');
      });
    }
  }

  async function prepare() {
    await new Promise((resolve) => document.fonts?.ready?.then(resolve).catch(resolve) || resolve());
    await waitForImages();
    await hydrateMermaid();
    await hydrateKatex();
    setupPageNumbers();
  }

  async function run() {
    try {
      await prepare();
      beacon({ phase: 'ready', mode: window.__WYSEE_MODE__, title: document.title });
      if (autoPrint) {
        setTimeout(() => {
          printButton.hidden = false;
          printButton.focus();
        }, 2000);
        window.print();
      }
    } catch (error) {
      beacon({ phase: 'error', error: String(error) });
      printButton.hidden = false;
    }
  }

  window.addEventListener('beforeprint', () => beacon({ phase: 'beforeprint' }));
  window.addEventListener('afterprint', () => beacon({ phase: 'afterprint' }));
  printButton?.addEventListener('click', () => window.print());
  document.addEventListener('DOMContentLoaded', run, { once: true });
})();
