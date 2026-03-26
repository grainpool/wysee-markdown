import { BrowserLaunchResult } from '../../types';
import { spawn } from 'child_process';

export class SafariAdapter {
  readonly name = 'SafariAdapter';

  async launch(url: string): Promise<BrowserLaunchResult> {
    if (process.platform !== 'darwin') {
      return { adapter: this.name, launched: false, detail: 'Safari is only available on macOS.' };
    }
    try {
      const child = spawn('open', ['-a', 'Safari', url], { detached: true, stdio: 'ignore' });
      child.unref();
      return { adapter: this.name, launched: true, detail: 'Opened with Safari.' };
    } catch {
      return { adapter: this.name, launched: false, detail: 'Safari could not be launched.' };
    }
  }
}
