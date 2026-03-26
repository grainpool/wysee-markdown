import * as vscode from 'vscode';
import { SpellService } from './spellService';

export class SpellCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly spellService: SpellService) {}

  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(document: vscode.TextDocument, range: vscode.Range): Promise<vscode.CodeAction[]> {
    const diagnostics = this.spellService.diagnostics.get(document.uri) ?? [];
    const hit = diagnostics.find((item) => item.range.intersection(range));
    if (!hit) {
      return [];
    }
    const word = document.getText(hit.range);
    const suggestions = await this.spellService.suggestions(word, document.uri);
    const actions: vscode.CodeAction[] = suggestions.map((suggestion) => {
      const action = new vscode.CodeAction(`Replace with “${suggestion}”`, vscode.CodeActionKind.QuickFix);
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, hit.range, suggestion);
      return action;
    });
    actions.push(makeCommandAction(`Add “${word}” to user dictionary`, 'wyseeMd.spell.addToUserDictionary', { word }));
    actions.push(makeCommandAction(`Add “${word}” to workspace dictionary`, 'wyseeMd.spell.addToWorkspaceDictionary', { word, uri: document.uri.toString() }));
    actions.push(makeCommandAction(`Ignore “${word}” in this session`, 'wyseeMd.spell.ignoreWordSession', { word }));
    actions.push(makeCommandAction(`Ignore “${word}” in this document`, 'wyseeMd.spell.ignoreWordDocument', { word, uri: document.uri.toString() }));
    return actions;
  }
}

function makeCommandAction(title: string, command: string, args: unknown): vscode.CodeAction {
  const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  action.command = { title, command, arguments: [args] };
  return action;
}
