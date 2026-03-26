import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { SpellResult } from '../types';
import { TraceService } from '../diagnostics/trace';
import { DictionaryService } from './dictionaryService';
import { CspellAdapter } from './cspellAdapter';
import { normalizeWord } from '../util/strings';

export class SpellService {
  readonly diagnostics = vscode.languages.createDiagnosticCollection('wysee-md-spell');
  private readonly dictionaryService: DictionaryService;
  private readonly adapter: CspellAdapter;

  constructor(private readonly context: vscode.ExtensionContext, private readonly trace: TraceService) {
    this.dictionaryService = new DictionaryService(context, trace);
    this.adapter = new CspellAdapter(this.dictionaryService);
  }

  async initialize(): Promise<void> {
    await this.dictionaryService.initialize();
  }

  async runSpellcheck(document: vscode.TextDocument): Promise<SpellResult> {
    const language = vscode.workspace.getConfiguration('wyseeMd', document.uri).get<string>('spell.language', 'en-US');
    const { diagnostics } = await this.adapter.checkDocument(document, language);
    const vscodeDiagnostics = diagnostics.map((item) => {
      const diagnostic = new vscode.Diagnostic(item.range, `Possible misspelling: ${item.word}`, vscode.DiagnosticSeverity.Information);
      diagnostic.source = 'Wysee MD';
      diagnostic.code = { value: 'wysee-md-spell', target: vscode.Uri.parse(`command:wyseeMd.spell.nextIssue`) };
      diagnostic.tags = [];
      diagnostic.relatedInformation = item.suggestions.length
        ? [new vscode.DiagnosticRelatedInformation(new vscode.Location(document.uri, item.range), `Suggestions: ${item.suggestions.join(', ')}`)]
        : [];
      return diagnostic;
    });
    this.diagnostics.set(document.uri, vscodeDiagnostics);
    return {
      diagnostics,
      sessionIgnoreWords: [],
      documentIgnoreWords: this.dictionaryService.getDocumentIgnoreWords(document.uri),
    };
  }

  isWordIgnoredOrCorrect(word: string, uri?: vscode.Uri): boolean {
    const normalized = normalizeWord(word);
    if (!normalized) {
      return true;
    }
    return this.dictionaryService.isKnownBase(word)
      || this.dictionaryService.isSessionIgnored(word)
      || this.dictionaryService.getDocumentIgnoreWords(uri ?? vscode.Uri.parse('untitled:untitled')).includes(normalized);
  }

  async isCorrect(word: string, uri?: vscode.Uri): Promise<boolean> {
    const language = vscode.workspace.getConfiguration('wyseeMd', uri).get<string>('spell.language', 'en-US');
    return this.dictionaryService.isCorrect(word, uri, language);
  }

  async addWordToUserDictionary(word: string): Promise<void> {
    const language = vscode.workspace.getConfiguration('wyseeMd').get<string>('spell.language', 'en-US');
    await this.dictionaryService.addWordToUserDictionary(word, language);
  }

  async addWordToWorkspaceDictionary(word: string, uri?: vscode.Uri): Promise<void> {
    await this.dictionaryService.addWordToWorkspaceDictionary(word, uri);
  }

  ignoreWordSession(word: string): void {
    this.dictionaryService.ignoreWordSession(word);
  }

  async ignoreWordDocument(uri: vscode.Uri, word: string): Promise<void> {
    const text = await fs.readFile(uri.fsPath, 'utf8');
    const pragma = /<!--\s*wysee:ignore-words\s+([^>]*)-->/i;
    if (pragma.test(text)) {
      const next = text.replace(pragma, (_all, words) => {
        const merged = new Set(String(words).split(',').map((item) => item.trim()).filter(Boolean));
        merged.add(word);
        return `<!-- wysee:ignore-words ${[...merged].join(', ')} -->`;
      });
      await fs.writeFile(uri.fsPath, next, 'utf8');
      return;
    }
    const insertion = `<!-- wysee:ignore-words ${word} -->\n\n`;
    await fs.writeFile(uri.fsPath, insertion + text, 'utf8');
  }

  async suggestions(word: string, uri?: vscode.Uri): Promise<string[]> {
    const language = vscode.workspace.getConfiguration('wyseeMd', uri).get<string>('spell.language', 'en-US');
    return this.dictionaryService.suggestions(word, uri, language);
  }
}
