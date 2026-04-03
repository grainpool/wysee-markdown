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
import YAML from 'yaml';

export interface TokenizedWord {
  word: string;
  start: number;
  end: number;
}

export interface IgnoreWordExtraction {
  words: string[];
  frontmatterWords: string[];
}

export function tokenizeForSpellcheck(document: vscode.TextDocument): { words: TokenizedWord[]; ignoreWords: IgnoreWordExtraction } {
  const original = document.getText();
  const buffer = original.split('');
  const ignoreWords = extractIgnoreWords(original);

  maskRange(buffer, ...frontmatterRange(original));
  maskRegex(buffer, /```[\s\S]*?```/g);
  maskRegex(buffer, /~~~[\s\S]*?~~~/g);
  maskRegex(buffer, /`[^`]+`/g);
  maskRegex(buffer, /\$\$[\s\S]+?\$\$/g);
  maskRegex(buffer, /(?<!\$)\$(?!\$)\S(?:[^\n$]*?\S)?\$(?!\$)/g);
  maskRegex(buffer, /https?:\/\/\S+/g);
  maskRegex(buffer, /<[^>]+>/g);
  maskLinkDestinations(buffer, original);

  const masked = buffer.join('');
  const words: TokenizedWord[] = [];
  const regex = /\b([A-Za-z][A-Za-z'’-]{1,})\b/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(masked))) {
    const word = match[1];
    if (/^[A-Z][A-Z]+$/.test(word) || /[0-9_]/.test(word)) {
      continue;
    }
    words.push({ word, start: match.index, end: match.index + word.length });
  }
  return { words, ignoreWords };
}

export function extractIgnoreWords(text: string): IgnoreWordExtraction {
  const words = new Set<string>();
  const frontmatterWords: string[] = [];
  const [start, end] = frontmatterRange(text);
  if (end > start) {
    try {
      const yaml = text.slice(start + 4, end - 4);
      const parsed = YAML.parse(yaml) as any;
      const value = parsed?.['wysee-ignore-words'];
      const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
      for (const item of items) {
        const word = String(item).trim().toLowerCase();
        if (word) {
          words.add(word);
          frontmatterWords.push(word);
        }
      }
    } catch {
      // ignore invalid frontmatter
    }
  }
  const pragma = /<!--\s*wysee:ignore-words\s+([^>]*)-->/gi;
  let match: RegExpExecArray | null;
  while ((match = pragma.exec(text))) {
    for (const part of match[1].split(',')) {
      const word = part.trim().toLowerCase();
      if (word) {
        words.add(word);
      }
    }
  }
  return { words: [...words], frontmatterWords };
}

function frontmatterRange(text: string): [number, number] {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    return [0, 0];
  }
  const end = text.indexOf('\n---', 4);
  return end >= 0 ? [0, end + 4] : [0, 0];
}

function maskRange(buffer: string[], start: number, end: number): void {
  for (let i = start; i < end && i < buffer.length; i += 1) {
    buffer[i] = ' ';
  }
}

function maskRegex(buffer: string[], regex: RegExp): void {
  const text = buffer.join('');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    maskRange(buffer, match.index, match.index + match[0].length);
  }
}

function maskLinkDestinations(buffer: string[], original: string): void {
  const regex = /\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(original))) {
    const full = match[0];
    const fullStart = match.index;
    const destStart = full.indexOf('](') + 2;
    const destEnd = full.length - 1;
    maskRange(buffer, fullStart + destStart, fullStart + destEnd);
  }
}
