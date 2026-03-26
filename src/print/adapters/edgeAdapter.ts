import { BrowserLaunchResult } from '../../types';
import { spawn } from 'child_process';

export class EdgeAdapter {
  readonly name = 'EdgeAdapter';
  constructor(private readonly browserPath?: string) {}

  async launch(url: string): Promise<BrowserLaunchResult> {
    const candidates = this.browserPath ? [this.browserPath] : ['msedge', 'microsoft-edge'];
    for (const command of candidates) {
      try {
        const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
        child.unref();
        return { adapter: this.name, launched: true, detail: `Spawned ${command}` };
      } catch {
        // ignore
      }
    }
    return { adapter: this.name, launched: false, detail: 'No Edge executable could be launched.' };
  }
}
