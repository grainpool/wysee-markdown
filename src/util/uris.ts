import * as path from 'path';
import * as vscode from 'vscode';

export function workspaceFolderForUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.getWorkspaceFolder(uri);
}

export function uriBasename(uri: vscode.Uri): string {
  return path.basename(uri.fsPath || uri.path);
}

export function resolveRelativePath(baseUri: vscode.Uri, maybeRelative: string): vscode.Uri | undefined {
  if (!maybeRelative || /^https?:/i.test(maybeRelative) || /^data:/i.test(maybeRelative)) {
    return undefined;
  }
  if (path.isAbsolute(maybeRelative)) {
    return vscode.Uri.file(maybeRelative);
  }
  return vscode.Uri.file(path.resolve(path.dirname(baseUri.fsPath), maybeRelative));
}
