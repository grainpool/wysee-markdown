import { BrowserLaunchResult } from '../../types';
import { spawn } from 'child_process';

export class FirefoxAdapter {
  readonly name = 'FirefoxAdapter';
  constructor(private readonly browserPath?: string) {}

  async launch(url: string): Promise<BrowserLaunchResult> {
    const candidates = this.browserPath ? [this.browserPath] : ['firefox'];
    for (const command of candidates) {
      try {
        const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
        child.unref();
        return { adapter: this.name, launched: true, detail: `Spawned ${command}` };
      } catch {
        // ignore
      }
    }
    return { adapter: this.name, launched: false, detail: 'No Firefox executable could be launched.' };
  }
}
