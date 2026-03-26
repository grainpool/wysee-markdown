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
