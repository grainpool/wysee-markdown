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
import { CTX, VIEWTYPE_EDITOR } from '../constants';
import { PreviewSessionState } from '../types';

export class ContextStateService {
  private activeSession?: PreviewSessionState;

  async applySession(session?: PreviewSessionState, editable = true, browserPrintAvailable = true): Promise<void> {
    this.activeSession = session;
    await vscode.commands.executeCommand('setContext', CTX.editorActive, Boolean(session));
    await vscode.commands.executeCommand('setContext', CTX.editorEditable, editable);
    await vscode.commands.executeCommand('setContext', CTX.spellMisspelled, Boolean(session?.contextWord));
    await vscode.commands.executeCommand('setContext', CTX.blockKind, session?.contextBlockKind ?? session?.focusedBlockKind ?? '');
    await vscode.commands.executeCommand('setContext', CTX.hasSelection, Boolean(session?.hasSelection));
    await vscode.commands.executeCommand('setContext', CTX.browserPrintAvailable, browserPrintAvailable);
    await vscode.commands.executeCommand('setContext', 'activeCustomEditorId', session ? VIEWTYPE_EDITOR : undefined);
    // Default: insertion is always available unless a panel overrides it
    await vscode.commands.executeCommand('setContext', CTX.canInsertBlock, Boolean(session));
  }

  async setCanInsertBlock(value: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', CTX.canInsertBlock, value);
  }

  async setEditPanelActive(value: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', CTX.editPanelActive, value);
  }

  async markMarkdownSourceActive(active: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', CTX.markdownSourceActive, active);
  }

  getActiveSession(): PreviewSessionState | undefined {
    return this.activeSession;
  }
}
