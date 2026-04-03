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
 * AiConfigPanelProvider — form-first webview for AI config
 *
 * Loads media/aiConfigPanel.html at runtime. Form fields are the primary
 * interface. Raw YAML at the bottom is bidirectionally synced via the
 * extension host (which owns the real YAML parser and field-level validator).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AiConfigService } from './aiConfigService';
import { AiSecretStore } from './aiSecretStore';
import { previewPrompt } from './aiPromptCompiler';
import { SYSTEM_TEMPLATES } from './types';

export class AiConfigPanelProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configService: AiConfigService,
    private readonly secretStore: AiSecretStore,
  ) {}

  async open(): Promise<void> {
    if (this.panel) { this.panel.reveal(); return; }
    this.panel = vscode.window.createWebviewPanel(
      'wysee.aiConfig', 'Wysee AI Configuration',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    this.panel.webview.html = this.getHtml();
    await this.sendCurrentConfig();
  }

  private async sendCurrentConfig(): Promise<void> {
    if (!this.panel) return;
    try {
      const config = await this.configService.readConfigRaw();
      this.panel.webview.postMessage({ type: 'loadConfig', config });
    } catch {
      this.panel.webview.postMessage({ type: 'loadConfig', config: null });
    }
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.sendCurrentConfig();
        break;

      case 'saveYaml': {
        const configPath = this.configService.getConfigPath();
        if (!configPath) { vscode.window.showErrorMessage('No workspace folder open.'); return; }
        const fsp = await import('fs/promises');
        await fsp.mkdir(path.dirname(configPath), { recursive: true });
        await fsp.writeFile(configPath, msg.yaml, 'utf-8');
        this.panel?.webview.postMessage({ type: 'saved' });
        break;
      }

      case 'parseYaml': {
        try {
          const YAML = await import('yaml');
          const parsed = YAML.parse(msg.yaml);
          if (parsed && typeof parsed === 'object') {
            const errors = validateConfig(parsed);
            this.panel?.webview.postMessage({ type: 'parsedConfig', config: parsed, errors, error: null });
          } else {
            this.panel?.webview.postMessage({ type: 'parsedConfig', config: null, errors: ['Root must be an object'], error: 'Root must be a YAML mapping' });
          }
        } catch (e: any) {
          this.panel?.webview.postMessage({ type: 'parsedConfig', config: null, errors: [e.message], error: e.message ?? 'Parse error' });
        }
        break;
      }

      case 'confirmDelete': {
        const name = msg.name || 'this model';
        const choice = await vscode.window.showWarningMessage(
          `Delete model profile "${name}"? This cannot be undone.`,
          { modal: true },
          'Delete',
        );
        if (choice === 'Delete') {
          this.panel?.webview.postMessage({ type: 'deleteConfirmed', index: msg.index });
        }
        break;
      }

      case 'setSecret':
        await this.secretStore.setSecretInteractive();
        break;

      case 'previewPrompt': {
        const config = await this.configService.readConfigRaw();
        const compiled = previewPrompt(config);
        const content = `# AI Prompt Preview\n\n## System Message\n\n\`\`\`\n${compiled.systemMessage}\n\`\`\`\n\n## User Message\n\n\`\`\`\n${compiled.userMessage}\n\`\`\`\n`;
        const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        break;
      }
    }
  }

  private getHtml(): string {
    const templateOptions = Object.entries(SYSTEM_TEMPLATES)
      .map(([id, t]) => `<option value="${id}">${escapeHtml(t.label)}</option>`)
      .join('');
    const htmlPath = path.join(this.context.extensionPath, 'media', 'aiConfigPanel.html');
    let html = fs.readFileSync(htmlPath, 'utf-8');
    html = html.replace('{{TEMPLATE_OPTIONS}}', templateOptions);
    return html;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Field-level validation ──────────────────────────────────────

const VALID_AUTH = ['none', 'bearer', 'custom-header'];
const VALID_SCHED_MODE = ['sequential', 'parallel'];
const VALID_SECTION_MODE = ['off', 'headingOnly', 'fullMarkdown'];
const VALID_TEMPLATES = Object.keys(SYSTEM_TEMPLATES);

function validateConfig(raw: any): string[] {
  const errs: string[] = [];
  if (raw.models !== undefined) {
    if (!Array.isArray(raw.models)) {
      errs.push('models: must be an array');
    } else {
      raw.models.forEach((m: any, i: number) => {
        const p = `models[${i}]`;
        if (!m || typeof m !== 'object') { errs.push(`${p}: must be an object`); return; }
        if (typeof m.name !== 'string' || !m.name.trim()) errs.push(`${p}.name: required non-empty string`);
        if (typeof m.provider !== 'string') errs.push(`${p}.provider: must be a string`);
        if (typeof m.model !== 'string') errs.push(`${p}.model: must be a string`);
        if (typeof m.endpoint !== 'string') errs.push(`${p}.endpoint: must be a string`);
        if (m.auth !== undefined && !VALID_AUTH.includes(m.auth)) errs.push(`${p}.auth: must be one of ${VALID_AUTH.join(', ')}`);
        if (m.chatPath !== undefined && typeof m.chatPath !== 'string') errs.push(`${p}.chatPath: must be a string`);

        if (m.requestScheduling) {
          if (typeof m.requestScheduling !== 'object') errs.push(`${p}.requestScheduling: must be an object`);
          else {
            if (m.requestScheduling.mode !== undefined && !VALID_SCHED_MODE.includes(m.requestScheduling.mode))
              errs.push(`${p}.requestScheduling.mode: must be one of ${VALID_SCHED_MODE.join(', ')}`);
            if (m.requestScheduling.maxConcurrent !== undefined) {
              const mc = m.requestScheduling.maxConcurrent;
              if (typeof mc !== 'number' || mc < 1 || mc > 12 || !Number.isInteger(mc))
                errs.push(`${p}.requestScheduling.maxConcurrent: must be integer 1–12`);
            }
          }
        }

        if (m.options) {
          if (typeof m.options !== 'object') errs.push(`${p}.options: must be an object`);
          else {
            if (m.options.temperature !== undefined) {
              if (typeof m.options.temperature !== 'number' || m.options.temperature < 0 || m.options.temperature > 2)
                errs.push(`${p}.options.temperature: must be number 0–2`);
            }
            if (m.options.maxTokens !== undefined) {
              if (typeof m.options.maxTokens !== 'number' || m.options.maxTokens < 64 || m.options.maxTokens > 8192 || !Number.isInteger(m.options.maxTokens))
                errs.push(`${p}.options.maxTokens: must be integer 64–8192`);
            }
            if (m.options.timeout !== undefined) {
              if (typeof m.options.timeout !== 'number' || m.options.timeout < 1000 || m.options.timeout > 120000)
                errs.push(`${p}.options.timeout: must be number 1000–120000`);
            }
            if (m.options.maxRetries !== undefined) {
              if (typeof m.options.maxRetries !== 'number' || m.options.maxRetries < 0 || m.options.maxRetries > 10 || !Number.isInteger(m.options.maxRetries))
                errs.push(`${p}.options.maxRetries: must be integer 0–10`);
            }
          }
        }
      });
    }
  }

  if (raw.activeModel !== undefined && typeof raw.activeModel !== 'string')
    errs.push('activeModel: must be a string');

  if (raw.context) {
    if (typeof raw.context !== 'object') errs.push('context: must be an object');
    else {
      if (raw.context.sectionContext) {
        if (typeof raw.context.sectionContext === 'object' && raw.context.sectionContext.mode !== undefined) {
          if (!VALID_SECTION_MODE.includes(raw.context.sectionContext.mode))
            errs.push(`context.sectionContext.mode: must be one of ${VALID_SECTION_MODE.join(', ')}`);
        } else if (typeof raw.context.sectionContext === 'string' && !VALID_SECTION_MODE.includes(raw.context.sectionContext)) {
          errs.push(`context.sectionContext: must be one of ${VALID_SECTION_MODE.join(', ')} or {mode: ...}`);
        }
      }
      if (raw.context.includeHeadingOutline !== undefined && typeof raw.context.includeHeadingOutline !== 'boolean')
        errs.push('context.includeHeadingOutline: must be a boolean');
      if (raw.context.headingOutlineDepth !== undefined) {
        const d = raw.context.headingOutlineDepth;
        if (typeof d !== 'number' || d < 1 || d > 6 || !Number.isInteger(d))
          errs.push('context.headingOutlineDepth: must be integer 1–6');
      }
      if (raw.context.selectedRevisionMessages !== undefined && typeof raw.context.selectedRevisionMessages !== 'boolean')
        errs.push('context.selectedRevisionMessages: must be a boolean');
      if (raw.context.selectedRevisionTags !== undefined && typeof raw.context.selectedRevisionTags !== 'boolean')
        errs.push('context.selectedRevisionTags: must be a boolean');
      if (raw.context.hunkCommitProvenance !== undefined && typeof raw.context.hunkCommitProvenance !== 'boolean')
        errs.push('context.hunkCommitProvenance: must be a boolean');
      if (raw.context.hunkCommitLimit !== undefined) {
        const l = raw.context.hunkCommitLimit;
        if (typeof l !== 'number' || l < 1 || l > 24 || !Number.isInteger(l))
          errs.push('context.hunkCommitLimit: must be integer 1–24');
      }
    }
  }

  if (raw.prompting) {
    if (typeof raw.prompting !== 'object') errs.push('prompting: must be an object');
    else {
      if (raw.prompting.template !== undefined && !VALID_TEMPLATES.includes(raw.prompting.template))
        errs.push(`prompting.template: must be one of ${VALID_TEMPLATES.join(', ')}`);
      for (const f of ['preamble', 'postamble', 'userAppendix']) {
        if ((raw.prompting as any)[f] !== undefined && typeof (raw.prompting as any)[f] !== 'string')
          errs.push(`prompting.${f}: must be a string`);
      }
    }
  }

  if (raw.output) {
    if (typeof raw.output !== 'object') errs.push('output: must be an object');
    else {
      if (raw.output.blankOnFailure !== undefined && typeof raw.output.blankOnFailure !== 'boolean')
        errs.push('output.blankOnFailure: must be a boolean');
    }
  }

  return errs;
}
