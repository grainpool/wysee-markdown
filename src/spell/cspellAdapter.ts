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
