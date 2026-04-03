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

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import wordListPath from 'word-list';
import { ensureDir, pathExists } from '../util/files';
import { normalizeWord } from '../util/strings';
import { TraceService } from '../diagnostics/trace';

export class DictionaryService {
  private baseWords?: Set<string>;
  private byFirstChar = new Map<string, string[]>();
  private readonly sessionIgnore = new Set<string>();
  private readonly documentIgnore = new Map<string, Set<string>>();
  private readonly customWordsCache = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext, private readonly trace: TraceService) {}

  async initialize(): Promise<void> {
    if (this.baseWords) {
      return;
    }
    const raw = await fs.readFile(wordListPath, 'utf8');
    this.baseWords = new Set();
    for (const line of raw.split(/\r?\n/)) {
      const word = normalizeWord(line.trim());
      if (!word) {
        continue;
      }
      this.baseWords.add(word);
      const key = word[0];
      const list = this.byFirstChar.get(key) ?? [];
      list.push(word);
      this.byFirstChar.set(key, list);
    }
    this.trace.info('Loaded base word list', { count: this.baseWords.size });
  }

  async getUserDictionaryPath(language: string): Promise<string> {
    const dir = path.join(this.context.globalStorageUri.fsPath, 'dictionaries');
    await ensureDir(dir);
    return path.join(dir, `${language}.txt`);
  }

  async getWorkspaceDictionaryPath(uri?: vscode.Uri): Promise<string | undefined> {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    const rel = vscode.workspace.getConfiguration('wyseeMd', uri).get<string>('spell.workspaceDictionaryPath', '.vscode/wysee-md/dictionary.txt');
    return path.join(folder.uri.fsPath, rel);
  }

  async addWordToUserDictionary(word: string, language: string): Promise<void> {
    await this.initialize();
    const normalized = normalizeWord(word);
    this.customWordsCache.add(normalized);
    const file = await this.getUserDictionaryPath(language);
    await ensureDir(path.dirname(file));
    await fs.appendFile(file, `${normalized}\n`, 'utf8');
  }

  async addWordToWorkspaceDictionary(word: string, uri?: vscode.Uri): Promise<void> {
    await this.initialize();
    const normalized = normalizeWord(word);
    this.customWordsCache.add(normalized);
    const file = await this.getWorkspaceDictionaryPath(uri);
    if (!file) {
      throw new Error('No workspace dictionary available without a workspace folder.');
    }
    await ensureDir(path.dirname(file));
    await fs.appendFile(file, `${normalized}\n`, 'utf8');
  }

  ignoreWordSession(word: string): void {
    this.sessionIgnore.add(normalizeWord(word));
  }

  setDocumentIgnoreWords(uri: vscode.Uri, words: string[]): void {
    this.documentIgnore.set(uri.toString(), new Set(words.map(normalizeWord).filter(Boolean)));
  }

  getDocumentIgnoreWords(uri: vscode.Uri): string[] {
    return [...(this.documentIgnore.get(uri.toString()) ?? new Set())];
  }

  clearDocument(uri: vscode.Uri): void {
    this.documentIgnore.delete(uri.toString());
  }

  async isCorrect(word: string, uri?: vscode.Uri, language = 'en-US'): Promise<boolean> {
    await this.initialize();
    const normalized = normalizeWord(word);
    if (!normalized) {
      return true;
    }
    if (this.baseWords?.has(normalized) || this.sessionIgnore.has(normalized)) {
      return true;
    }
    if (uri && this.documentIgnore.get(uri.toString())?.has(normalized)) {
      return true;
    }
    const user = await this.loadUserDictionary(language);
    if (user.has(normalized)) {
      return true;
    }
    if (uri) {
      const workspace = await this.loadWorkspaceDictionary(uri);
      if (workspace.has(normalized)) {
        return true;
      }
    }
    return false;
  }

  async suggestions(word: string, uri?: vscode.Uri, language = 'en-US'): Promise<string[]> {
    await this.initialize();
    const normalized = normalizeWord(word);
    const first = normalized[0] ?? '';
    const bucket = this.byFirstChar.get(first) ?? [];
    const candidates = bucket.filter((candidate) => Math.abs(candidate.length - normalized.length) <= 2);
    const scored = candidates
      .map((candidate) => ({ candidate, score: levenshtein(candidate, normalized) }))
      .filter((item) => item.score <= 2)
      .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
      .slice(0, 5)
      .map((item) => item.candidate);
    const merged = new Set(scored);
    const user = await this.loadUserDictionary(language);
    for (const candidate of user) {
      if (candidate.startsWith(first) && Math.abs(candidate.length - normalized.length) <= 2 && levenshtein(candidate, normalized) <= 2) {
        merged.add(candidate);
      }
    }
    if (uri) {
      const workspace = await this.loadWorkspaceDictionary(uri);
      for (const candidate of workspace) {
        if (candidate.startsWith(first) && Math.abs(candidate.length - normalized.length) <= 2 && levenshtein(candidate, normalized) <= 2) {
          merged.add(candidate);
        }
      }
    }
    return [...merged].slice(0, 5);
  }

  isKnownBase(word: string): boolean {
    const normalized = normalizeWord(word);
    if (!normalized) {
      return true;
    }
    return Boolean(this.baseWords?.has(normalized)) || this.customWordsCache.has(normalized);
  }

  isSessionIgnored(word: string): boolean {
    return this.sessionIgnore.has(normalizeWord(word));
  }

  private async loadUserDictionary(language: string): Promise<Set<string>> {
    const file = await this.getUserDictionaryPath(language);
    return this.loadDictionaryFile(file);
  }

  private async loadWorkspaceDictionary(uri: vscode.Uri): Promise<Set<string>> {
    const file = await this.getWorkspaceDictionaryPath(uri);
    return file ? this.loadDictionaryFile(file) : new Set();
  }

  private async loadDictionaryFile(filePath: string): Promise<Set<string>> {
    if (!(await pathExists(filePath))) {
      return new Set();
    }
    const raw = await fs.readFile(filePath, 'utf8');
    return new Set(raw.split(/\r?\n/).map(normalizeWord).filter(Boolean));
  }
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}
