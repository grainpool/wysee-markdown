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

import * as assert from 'assert';
import * as vscode from 'vscode';
import { BrowserPrintTransportManager } from '../src/print/browserPrintTransportManager';
import { TraceService } from '../src/diagnostics/trace';

describe('browser adapter resolution', () => {
  it('resolves configured browser family names', () => {
    (vscode as any).__state.config.wyseeMd['print.browserFamily'] = 'firefox';
    const manager = new BrowserPrintTransportManager(new TraceService());
    assert.strictEqual(manager.resolveAdapterName(), 'FirefoxAdapter');
    (vscode as any).__state.config.wyseeMd['print.browserFamily'] = 'system';
  });
});
