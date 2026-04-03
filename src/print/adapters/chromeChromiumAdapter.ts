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
