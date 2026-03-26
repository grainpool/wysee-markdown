import { BrowserLaunchResult } from '../../types';
import { spawn } from 'child_process';

export class ChromeChromiumAdapter {
  readonly name = 'ChromeChromiumAdapter';
  constructor(private readonly browserPath?: string) {}

  async launch(url: string): Promise<BrowserLaunchResult> {
    const candidates = this.browserPath ? [this.browserPath] : ['google-chrome', 'chromium', 'chromium-browser'];
    return trySpawn(this.name, candidates, [url]);
  }
}

async function trySpawn(name: string, commands: string[], args: string[]): Promise<BrowserLaunchResult> {
  for (const command of commands) {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.unref();
      return { adapter: name, launched: true, detail: `Spawned ${command}` };
    } catch {
      // continue
    }
  }
  return { adapter: name, launched: false, detail: 'No Chrome/Chromium executable could be launched.' };
}
