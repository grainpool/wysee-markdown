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
