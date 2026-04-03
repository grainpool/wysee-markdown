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
import { BrowserLaunchResult } from '../../types';

export class SystemBrowserAdapter {
  readonly name = 'SystemBrowserAdapter';

  async launch(url: string): Promise<BrowserLaunchResult> {
    const launched = await vscode.env.openExternal(vscode.Uri.parse(url));
    return { adapter: this.name, launched, detail: launched ? 'Opened via vscode.env.openExternal' : 'openExternal returned false' };
  }
}
