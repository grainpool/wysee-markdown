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

/**
 * AiSecretStore — named secrets via VS Code SecretStorage
 *
 * Secrets are referenced in ai-config.yaml as ${{ secrets.KEY_NAME }}
 * and stored/managed via command palette.
 */

import * as vscode from 'vscode';

const SECRET_PREFIX = 'wysee.ai.secret.';

export class AiSecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getSecret(name: string): Promise<string | undefined> {
    return this.secrets.get(`${SECRET_PREFIX}${name}`);
  }

  async setSecret(name: string, value: string): Promise<void> {
    await this.secrets.store(`${SECRET_PREFIX}${name}`, value);
  }

  async deleteSecret(name: string): Promise<void> {
    await this.secrets.delete(`${SECRET_PREFIX}${name}`);
  }

  async hasSecret(name: string): Promise<boolean> {
    const val = await this.getSecret(name);
    return Boolean(val && val.length > 0);
  }

  /**
   * Interactive command: prompt user for secret name and value.
   */
  async setSecretInteractive(): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: 'Set AI Secret',
      prompt: 'Enter the secret name (e.g. OPENAI_API_KEY). Use this name in ai-config.yaml as ${{ secrets.NAME }}',
      placeHolder: 'OPENAI_API_KEY',
      validateInput: (v) => {
        if (!v.trim()) return 'Name is required';
        if (!/^\w+$/.test(v.trim())) return 'Name must be alphanumeric with underscores only';
        return null;
      },
    });
    if (!name) return;

    const value = await vscode.window.showInputBox({
      title: `Set secret: ${name.trim()}`,
      prompt: 'Paste the API key or token value',
      password: true,
    });
    if (value === undefined) return;

    await this.setSecret(name.trim(), value);
    vscode.window.showInformationMessage(`Secret "${name.trim()}" saved. Reference it in ai-config.yaml as: $\{{ secrets.${name.trim()} }}`);
  }

  /**
   * Interactive command: clear a stored secret.
   */
  async clearSecretInteractive(): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: 'Clear AI Secret',
      prompt: 'Enter the secret name to remove',
      placeHolder: 'OPENAI_API_KEY',
    });
    if (!name) return;

    await this.deleteSecret(name.trim());
    vscode.window.showInformationMessage(`Secret "${name.trim()}" cleared.`);
  }
}
