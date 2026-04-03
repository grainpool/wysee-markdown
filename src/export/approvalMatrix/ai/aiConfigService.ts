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
 * AiConfigService — reads .wysee/ai-config.yaml, resolves ${{ secrets.X }}
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { AiConfig, AiModelEntry, DEFAULT_CONFIG } from './types';
import { AiSecretStore } from './aiSecretStore';

const CONFIG_FILENAME = 'ai-config.yaml';
const CONFIG_DIR = '.wysee';

const SECRET_REF_PATTERN = /\$\{\{\s*secrets\.(\w+)\s*\}\}/g;

const SCAFFOLD_YAML = `# Wysee Approval Matrix — AI summary configuration
# Edit this file to configure AI-assisted change summaries for export.
# Secrets: use $\{{ secrets.KEY_NAME }} and store values via the command palette:
#   Wysee: Set AI Secret…
#
# Available prompt templates:
#   default-review-summary, release-notes-review, compliance-review, api-doc-review

models:
  # Example: local Ollama model (no API key needed)
  # - name: Qwen3-Coder 30B
  #   provider: ollama
  #   model: qwen3-coder:30b
  #   endpoint: http://localhost:11434/v1
  #   auth: none
  #   chatPath: chat              # override default 'chat/completions'
  #   options:
  #     temperature: 0.3
  #     maxTokens: 2000
  #     timeout: 30000

  # Example: OpenAI
  # - name: GPT-4o Mini
  #   provider: openai
  #   model: gpt-4o-mini
  #   endpoint: https://api.openai.com/v1
  #   auth: bearer
  #   apiKey: $\{{ secrets.OPENAI_API_KEY }}
  #   options:
  #     temperature: 0.3
  #     maxTokens: 2000

activeModel: ""

context:
  sectionContext:
    mode: fullMarkdown          # off | headingOnly | fullMarkdown
  includeHeadingOutline: false
  headingOutlineDepth: 2
  selectedRevisionMessages: true
  selectedRevisionTags: true
  hunkCommitProvenance: true
  hunkCommitLimit: 10
  customFields: {}
  # manifestPath: ""            # legacy: path to manifest JSON

prompting:
  template: default-review-summary
  preamble: ""
  postamble: ""
  userAppendix: ""

output:
  blankOnFailure: true
`;

export class AiConfigService {
  constructor(private readonly secretStore: AiSecretStore) {}

  /** Get the config file path for the current workspace */
  getConfigPath(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) return undefined;
    return path.join(workspaceFolders[0].uri.fsPath, CONFIG_DIR, CONFIG_FILENAME);
  }

  /** Read and parse the YAML config, resolving secret references */
  async readConfig(): Promise<AiConfig> {
    const configPath = this.getConfigPath();
    if (!configPath) return { ...DEFAULT_CONFIG };

    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      const YAML = await import('yaml');
      const parsed = YAML.parse(raw) as any;
      if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_CONFIG };

      const config = this.normalizeConfig(parsed);
      // Resolve secret references in apiKey fields
      for (const model of config.models) {
        if (model.apiKey) {
          model.apiKey = await this.resolveSecretRefs(model.apiKey);
        }
      }
      return config;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /** Read config without resolving secrets (for display/validation) */
  async readConfigRaw(): Promise<AiConfig> {
    const configPath = this.getConfigPath();
    if (!configPath) return { ...DEFAULT_CONFIG };
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      const YAML = await import('yaml');
      const parsed = YAML.parse(raw) as any;
      return parsed ? this.normalizeConfig(parsed) : { ...DEFAULT_CONFIG };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /** Check if config file exists */
  async configExists(): Promise<boolean> {
    const configPath = this.getConfigPath();
    if (!configPath) return false;
    try {
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Create the scaffold config file and open it */
  async scaffoldAndOpen(): Promise<void> {
    const configPath = this.getConfigPath();
    if (!configPath) {
      vscode.window.showErrorMessage('No workspace folder open. Open a folder first.');
      return;
    }

    const dirPath = path.dirname(configPath);
    await fs.mkdir(dirPath, { recursive: true });

    const exists = await this.configExists();
    if (!exists) {
      await fs.writeFile(configPath, SCAFFOLD_YAML, 'utf-8');
    }

    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  /** Get the active model from config */
  async getActiveModel(): Promise<AiModelEntry | undefined> {
    const config = await this.readConfig();
    if (!config.activeModel || !config.models.length) return undefined;
    return config.models.find(m => m.name === config.activeModel);
  }

  /** Get all model names */
  async getModelNames(): Promise<string[]> {
    const config = await this.readConfigRaw();
    return config.models.map(m => m.name);
  }

  /** Resolve ${{ secrets.KEY_NAME }} references */
  private async resolveSecretRefs(value: string): Promise<string> {
    const matches = [...value.matchAll(SECRET_REF_PATTERN)];
    if (!matches.length) return value;

    let resolved = value;
    for (const match of matches) {
      const secretName = match[1];
      const secretValue = await this.secretStore.getSecret(secretName);
      resolved = resolved.replace(match[0], secretValue ?? '');
    }
    return resolved;
  }

  private normalizeConfig(raw: any): AiConfig {
    // Resolve sectionContext.mode with legacy migration
    let sectionMode: 'off' | 'headingOnly' | 'fullMarkdown' = 'fullMarkdown';
    if (raw.context?.sectionContext?.mode) {
      const m = raw.context.sectionContext.mode;
      if (m === 'off' || m === 'headingOnly' || m === 'fullMarkdown') sectionMode = m;
    } else if (raw.context?.includeSectionPath === false) {
      sectionMode = 'off';
    } else if (raw.context?.includeSectionPath === true) {
      sectionMode = 'headingOnly';
    }

    return {
      models: Array.isArray(raw.models) ? raw.models.map((m: any) => this.normalizeModel(m)) : [],
      activeModel: String(raw.activeModel ?? ''),
      context: {
        sectionContext: { mode: sectionMode },
        includeHeadingOutline: Boolean(raw.context?.includeHeadingOutline),
        headingOutlineDepth: Number(raw.context?.headingOutlineDepth ?? 2),
        outlinePath: String(raw.context?.outlinePath ?? ''),
        outline: String(raw.context?.outline ?? ''),
        selectedRevisionMessages: raw.context?.selectedRevisionMessages !== false,
        selectedRevisionTags: raw.context?.selectedRevisionTags !== false,
        hunkCommitProvenance: raw.context?.hunkCommitProvenance !== false,
        hunkCommitLimit: Number(raw.context?.hunkCommitLimit ?? 10),
        hunkCommitOrder: 'oldest-first',
        customFields: (raw.context?.customFields && typeof raw.context.customFields === 'object')
          ? Object.fromEntries(Object.entries(raw.context.customFields).map(([k, v]) => [k, String(v)]))
          : {},
        includeManifest: raw.context?.includeManifest !== false,
        manifestPath: String(raw.context?.manifestPath ?? ''),
      },
      prompting: {
        template: String(raw.prompting?.template ?? 'default-review-summary'),
        preamble: String(raw.prompting?.preamble ?? ''),
        postamble: String(raw.prompting?.postamble ?? ''),
        userAppendix: String(raw.prompting?.userAppendix ?? ''),
      },
      output: {
        blankOnFailure: raw.output?.blankOnFailure !== false,
      },
    };
  }

  private normalizeModel(raw: any): AiModelEntry {
    // Resolve requestScheduling with legacy migration
    let scheduling: { mode: 'sequential' | 'parallel'; maxConcurrent?: number } | undefined;
    if (raw.requestScheduling?.mode) {
      const mode = raw.requestScheduling.mode === 'parallel' ? 'parallel' : 'sequential';
      const maxConcurrent = mode === 'parallel'
        ? Math.max(1, Math.min(Number(raw.requestScheduling.maxConcurrent ?? 3), 12))
        : undefined;
      scheduling = { mode, maxConcurrent };
    } else if (raw.options?.concurrency !== undefined) {
      // Legacy: options.concurrency -> requestScheduling
      const c = Number(raw.options.concurrency);
      if (c <= 1) {
        scheduling = { mode: 'sequential' };
      } else {
        scheduling = { mode: 'parallel', maxConcurrent: Math.min(c, 12) };
      }
    }

    return {
      name: String(raw.name ?? ''),
      provider: String(raw.provider ?? 'openai'),
      model: String(raw.model ?? ''),
      endpoint: String(raw.endpoint ?? ''),
      auth: ['none', 'bearer', 'custom-header'].includes(raw.auth) ? raw.auth : 'none',
      apiKey: raw.apiKey ? String(raw.apiKey) : undefined,
      authHeader: raw.authHeader ? String(raw.authHeader) : undefined,
      options: {
        temperature: Number(raw.options?.temperature ?? 0.3),
        maxTokens: Number(raw.options?.maxTokens ?? 2000),
        timeout: Number(raw.options?.timeout ?? 30000),
        maxRetries: Number(raw.options?.maxRetries ?? 2),
        retryBackoff: Number(raw.options?.retryBackoff ?? 1000),
        concurrency: Number(raw.options?.concurrency ?? 3), // legacy, kept for compat
      },
      requestBody: raw.requestBody && typeof raw.requestBody === 'object' ? raw.requestBody : undefined,
      chatPath: raw.chatPath ? String(raw.chatPath) : undefined,
      requestScheduling: scheduling,
    };
  }
}
