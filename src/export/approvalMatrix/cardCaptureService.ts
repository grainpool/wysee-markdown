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
 * CardCaptureService
 *
 * Uses a hidden VS Code webview to render card HTML fragments
 * and capture them as PNG images.
 *
 * Technique: renders each card's HTML directly in the webview,
 * serializes to SVG foreignObject, converts to a data: URL
 * (not blob: — avoids CSP blocks), draws onto canvas, exports PNG.
 *
 * Cards are processed sequentially to avoid DOM contention.
 */

import * as vscode from 'vscode';
import { CardHtmlPair } from './cardHtmlBuilder';
import { HunkCardImages, CARD_HEIGHT_MIN } from './types';
import { TraceService } from '../../diagnostics/trace';

interface CaptureResult {
  hunkIndex: number;
  side: 'previous' | 'current';
  dataUrl: string;
  width: number;
  height: number;
  truncated: boolean;
}

export async function captureCardImages(
  pairs: CardHtmlPair[],
  cardWidth: number,
  cardMaxHeight: number,
  trace: TraceService,
): Promise<HunkCardImages[]> {
  if (!pairs.length) return [];

  return new Promise<HunkCardImages[]>((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'wysee-card-capture',
      'Capturing cards…',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    // Minimize visual disruption
    const results: CaptureResult[] = [];
    const expectedCount = pairs.length * 2;
    let timeoutHandle: ReturnType<typeof setTimeout>;

    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'captureResult') {
        results.push(msg.data);
        trace.trace('Card captured', { hunk: msg.data.hunkIndex, side: msg.data.side, w: msg.data.width, h: msg.data.height });
        if (results.length >= expectedCount) {
          clearTimeout(timeoutHandle);
          panel.dispose();
          resolve(assembleResults(results, pairs));
        }
      } else if (msg.type === 'captureError') {
        trace.warn('Card capture error', { error: msg.error, hunkIndex: msg.hunkIndex, side: msg.side });
        results.push({
          hunkIndex: msg.hunkIndex,
          side: msg.side,
          dataUrl: '',
          width: 0,
          height: 0,
          truncated: false,
        });
        if (results.length >= expectedCount) {
          clearTimeout(timeoutHandle);
          panel.dispose();
          resolve(assembleResults(results, pairs));
        }
      } else if (msg.type === 'ready') {
        // Send all card data to the webview
        panel.webview.postMessage({
          type: 'captureAll',
          pairs: pairs.map(p => ({
            hunkIndex: p.hunkIndex,
            previousHtml: p.previousHtml,
            currentHtml: p.currentHtml,
          })),
          cardWidth,
          cardMaxHeight,
          cardHeightMin: CARD_HEIGHT_MIN,
        });
      }
    });

    timeoutHandle = setTimeout(() => {
      trace.warn('Card capture timed out', { received: results.length, expected: expectedCount });
      panel.dispose();
      resolve(assembleResults(results, pairs));
    }, 60000); // 60s for large diffs

    panel.webview.html = buildCaptureWebviewHtml();
  });
}

function assembleResults(results: CaptureResult[], pairs: CardHtmlPair[]): HunkCardImages[] {
  const map = new Map<string, CaptureResult>();
  for (const r of results) {
    map.set(`${r.hunkIndex}-${r.side}`, r);
  }

  return pairs.map(pair => {
    const prev = map.get(`${pair.hunkIndex}-previous`);
    const cur = map.get(`${pair.hunkIndex}-current`);

    return {
      hunkIndex: pair.hunkIndex,
      previous: prev?.dataUrl ? {
        png: Buffer.from(prev.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'),
        width: prev.width,
        height: prev.height,
        truncated: prev.truncated,
      } : null,
      current: cur?.dataUrl ? {
        png: Buffer.from(cur.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'),
        width: cur.width,
        height: cur.height,
        truncated: cur.truncated,
      } : null,
    };
  });
}

function buildCaptureWebviewHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  #render-host { position: absolute; top: 0; left: 0; }
</style>
</head>
<body>
<div id="render-host"></div>
<script>
const vscode = acquireVsCodeApi();
const host = document.getElementById('render-host');

vscode.postMessage({ type: 'ready' });

window.addEventListener('message', async (event) => {
  const msg = event.data;
  if (msg.type !== 'captureAll') return;

  const pairs = msg.pairs;
  const cardWidth = msg.cardWidth;
  const cardMaxHeight = msg.cardMaxHeight;
  const cardHeightMin = msg.cardHeightMin || 48;

  for (const pair of pairs) {
    await captureOne(pair.hunkIndex, 'previous', pair.previousHtml, cardWidth, cardMaxHeight, cardHeightMin);
    await captureOne(pair.hunkIndex, 'current', pair.currentHtml, cardWidth, cardMaxHeight, cardHeightMin);
  }
});

async function captureOne(hunkIndex, side, cardHtml, cardWidth, cardMaxHeight, cardHeightMin) {
  try {
    // Extract just the <body> content and <style> from the card HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(cardHtml, 'text/html');

    // Collect all styles from the card document
    const styles = Array.from(doc.querySelectorAll('style')).map(s => s.textContent).join('\\n');

    // Get the card element
    const cardEl = doc.querySelector('.card');
    if (!cardEl) throw new Error('No .card element found in card HTML');

    // Inject into host
    host.innerHTML = '';
    const styleEl = document.createElement('style');
    styleEl.textContent = styles;
    host.appendChild(styleEl);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = cardEl.outerHTML;
    host.appendChild(wrapper);

    // Wait for rendering
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 50));

    const rendered = host.querySelector('.card');
    if (!rendered) throw new Error('Card not found after injection');

    const rect = rendered.getBoundingClientRect();
    const naturalHeight = Math.ceil(rect.height);
    const naturalWidth = Math.ceil(rect.width);
    const truncated = naturalHeight > cardMaxHeight;
    const finalHeight = Math.max(cardHeightMin, Math.min(naturalHeight, cardMaxHeight));
    const finalWidth = Math.max(1, naturalWidth);

    // Canvas capture via SVG foreignObject with data: URL (CSP safe)
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = finalWidth * scale;
    canvas.height = finalHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Clone the rendered content for serialization
    const clone = rendered.cloneNode(true);
    // Force explicit dimensions on the clone
    clone.style.width = finalWidth + 'px';
    clone.style.height = finalHeight + 'px';
    clone.style.overflow = 'hidden';

    // Build XHTML string
    const xmlns = 'http://www.w3.org/1999/xhtml';
    const outerHtml = new XMLSerializer().serializeToString(clone);

    // Wrap in full XHTML document with styles
    const xhtml = '<div xmlns="' + xmlns + '"><style>' + escapeForXml(styles) + '</style>' + outerHtml + '</div>';

    const svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="' + finalWidth + '" height="' + finalHeight + '">'
      + '<foreignObject width="100%" height="100%">' + xhtml + '</foreignObject></svg>';

    // Use data: URL instead of blob: to avoid CSP issues
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);

    const img = new Image();
    img.width = finalWidth;
    img.height = finalHeight;

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = (e) => reject(new Error('Image load failed: ' + String(e)));
      img.src = dataUrl;
    });

    ctx.drawImage(img, 0, 0, finalWidth, finalHeight);

    const pngDataUrl = canvas.toDataURL('image/png');

    // Clean up
    host.innerHTML = '';

    vscode.postMessage({
      type: 'captureResult',
      data: {
        hunkIndex,
        side,
        dataUrl: pngDataUrl,
        width: finalWidth,
        height: finalHeight,
        truncated,
      },
    });
  } catch (err) {
    host.innerHTML = '';
    vscode.postMessage({
      type: 'captureError',
      hunkIndex,
      side,
      error: String(err && err.message ? err.message : err),
    });
  }
}

function escapeForXml(str) {
  // Ensure CDATA-safe: replace ]]> sequences
  return str.replace(/]]>/g, ']]&gt;');
}
</script>
</body>
</html>`;
}
