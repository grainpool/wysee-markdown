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
