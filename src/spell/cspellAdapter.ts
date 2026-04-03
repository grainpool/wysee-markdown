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
import { DictionaryService } from './dictionaryService';
import { tokenizeForSpellcheck } from './spellTokenizer';
import { SpellDiagnostic } from '../types';

// V2 runtime fallback for environments where cspell-lib packaging is unavailable.
export class CspellAdapter {
  constructor(private readonly dictionaryService: DictionaryService) {}

  async checkDocument(document: vscode.TextDocument, language: string): Promise<{ diagnostics: SpellDiagnostic[]; ignoreWords: string[] }> {
    const tokenized = tokenizeForSpellcheck(document);
    this.dictionaryService.setDocumentIgnoreWords(document.uri, tokenized.ignoreWords.words);
    const diagnostics: SpellDiagnostic[] = [];
    for (const token of tokenized.words) {
      const word = token.word.toLowerCase();
      if (tokenized.ignoreWords.words.includes(word)) {
        continue;
      }
      if (await this.dictionaryService.isCorrect(word, document.uri, language)) {
        continue;
      }
      diagnostics.push({
        word,
        range: new vscode.Range(document.positionAt(token.start), document.positionAt(token.end)),
        suggestions: await this.dictionaryService.suggestions(word, document.uri, language),
        source: 'spell',
      });
    }
    return { diagnostics, ignoreWords: tokenized.ignoreWords.words };
  }
}
