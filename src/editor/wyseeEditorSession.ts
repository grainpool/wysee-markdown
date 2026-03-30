import * as vscode from 'vscode';
import { PreviewSessionState, RenderViewModel } from '../types';
import { DiffTabContext } from '../diff/gitDiffContext';

export interface WyseeEditorSession {
  createdAt: number;
  sessionId: string;
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  state: PreviewSessionState;
  model?: RenderViewModel;
  diffContext?: DiffTabContext;
  diffLayoutMeasurements?: Record<string, number>;
  diffViewportRatio?: number;
}
