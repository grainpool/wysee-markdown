import * as vscode from 'vscode';
import { BrowserLaunchResult } from '../../types';

export class SystemBrowserAdapter {
  readonly name = 'SystemBrowserAdapter';

  async launch(url: string): Promise<BrowserLaunchResult> {
    const launched = await vscode.env.openExternal(vscode.Uri.parse(url));
    return { adapter: this.name, launched, detail: launched ? 'Opened via vscode.env.openExternal' : 'openExternal returned false' };
  }
}
