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

import * as vscode from 'vscode';
import { BrowserLaunchResult } from '../types';
import { TraceService } from '../diagnostics/trace';
import { SystemBrowserAdapter } from './adapters/systemBrowserAdapter';
import { ChromeChromiumAdapter } from './adapters/chromeChromiumAdapter';
import { EdgeAdapter } from './adapters/edgeAdapter';
import { FirefoxAdapter } from './adapters/firefoxAdapter';
import { SafariAdapter } from './adapters/safariAdapter';
import { spawn } from 'child_process';

export class BrowserPrintTransportManager {
  private readonly system = new SystemBrowserAdapter();

  constructor(private readonly trace: TraceService) {}

  async open(url: string): Promise<BrowserLaunchResult> {
    const config = vscode.workspace.getConfiguration('wyseeMd');
    const browserFamily = config.get<string>('print.browserFamily', 'system');
    const browserPath = config.get<string>('print.browserPath', '');
    const order = config.get<string[]>('print.adapterOrder', ['configuredBrowser', 'systemBrowser', 'osOpen']);

    for (const key of order) {
      const result = await this.launchWithKey(key, url, browserFamily, browserPath);
      this.trace.info('Print adapter attempt', result);
      if (result.launched) {
        return result;
      }
    }
    return { adapter: 'none', launched: false, detail: 'No browser adapter could launch the print URL.' };
  }

  resolveAdapterName(): string {
    const browserFamily = vscode.workspace.getConfiguration('wyseeMd').get<string>('print.browserFamily', 'system');
    switch (browserFamily) {
      case 'chrome': return 'ChromeChromiumAdapter';
      case 'edge': return 'EdgeAdapter';
      case 'firefox': return 'FirefoxAdapter';
      case 'safari': return 'SafariAdapter';
      default: return 'SystemBrowserAdapter';
    }
  }

  private async launchWithKey(key: string, url: string, family: string, pathHint: string): Promise<BrowserLaunchResult> {
    if (key === 'systemBrowser') {
      return this.system.launch(url);
    }
    if (key === 'configuredBrowser') {
      switch (family) {
        case 'chrome': return new ChromeChromiumAdapter(pathHint || undefined).launch(url);
        case 'edge': return new EdgeAdapter(pathHint || undefined).launch(url);
        case 'firefox': return new FirefoxAdapter(pathHint || undefined).launch(url);
        case 'safari': return new SafariAdapter().launch(url);
        case 'system':
        default:
          return { adapter: 'configuredBrowser', launched: false, detail: 'No explicit browser family configured.' };
      }
    }
    if (key === 'osOpen') {
      return osOpen(url);
    }
    return { adapter: key, launched: false, detail: `Unknown adapter key: ${key}` };
  }
}

async function osOpen(url: string): Promise<BrowserLaunchResult> {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', shell: true }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    return { adapter: 'OsOpenAdapter', launched: true, detail: 'Opened via OS opener.' };
  } catch {
    return { adapter: 'OsOpenAdapter', launched: false, detail: 'OS opener failed.' };
  }
}
