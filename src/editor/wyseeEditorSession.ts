import * as vscode from 'vscode';
import { PreviewSessionState, RenderViewModel } from '../types';

export interface WyseeEditorSession {
  sessionId: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  state: PreviewSessionState;
  model?: RenderViewModel;
}
