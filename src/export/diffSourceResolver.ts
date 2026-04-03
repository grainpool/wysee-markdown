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

/**
 * DiffSourceResolver — Stage 4
 *
 * Resolves a normalized pair of markdown documents from any supported mode:
 * - workingTree: current file vs most recent commit
 * - revisionSelection: active file at two specified revisions
 * - openDiffPair: literal left/right docs already open in a diff editor
 */

import * as vscode from 'vscode';
import { TraceService } from '../diagnostics/trace';
import { MarkdownRenderer } from '../render/markdownRenderer';
import { RenderViewModel } from '../types';
import { buildSideBySideDiffPresentations, buildAllAddedPresentation } from '../diff/blockDiff';
import { getBackingFileUri, getGitApi, GitApiLike, resolveGitWorkingTreeComparison, resolveDiffTabContext } from '../diff/gitDiffContext';
import { WyseeEditorProvider } from '../editor/wyseeEditorProvider';

// ── Types ──────────────────────────────────────────────────────────

export type DiffSourceMode = 'workingTree' | 'revisionSelection' | 'openDiffPair';

export type RevisionToken = 'most-recent-commit' | 'current-changes' | string; // hex hash

export interface DiffSourceSpec {
  mode: DiffSourceMode;
  fileUri: vscode.Uri;
  previousToken?: RevisionToken;
  newToken?: RevisionToken;
  /** Labels for metadata */
  previousLabel: string;
  newLabel: string;
}

export interface NormalizedDiffPair {
  baseModel: RenderViewModel;
  currentModel: RenderViewModel;
  spec: DiffSourceSpec;
}

// ── Validation ─────────────────────────────────────────────────────

const HEX_HASH_REGEX = /^[0-9a-f]{6,40}$/i;

export function isValidRevisionToken(token: string): boolean {
  return token === 'most-recent-commit' || token === 'current-changes' || HEX_HASH_REGEX.test(token);
}

// ── Resolver ───────────────────────────────────────────────────────

export class DiffSourceResolver {
  constructor(
    private readonly provider: WyseeEditorProvider,
    private readonly renderer: MarkdownRenderer,
    private readonly trace: TraceService,
  ) {}

  /**
   * Detect the best diff source mode from the current editor context.
   * Returns a pre-filled spec that can be used directly or overridden by a dialog.
   */
  detectCurrentContext(): { mode: DiffSourceMode; fileUri?: vscode.Uri; originalUri?: vscode.Uri; modifiedUri?: vscode.Uri } {
    const session = this.provider.getActiveSession();
    if (!session) return { mode: 'workingTree' };

    const rawUri = session.document.uri;
    const fileUri = getBackingFileUri(rawUri);

    // Check if we're in a diff tab
    if (session.diffContext) {
      const backingFile = getBackingFileUri(rawUri);
      const backingCounterpart = getBackingFileUri(session.diffContext.counterpartUri);

      // If both sides resolve to the same backing file, it's a working-tree or git diff
      if (backingFile && backingCounterpart && backingFile.fsPath === backingCounterpart.fsPath) {
        return { mode: 'workingTree', fileUri: backingFile };
      }

      // Different files = ad hoc diff pair
      const originalUri = session.diffContext.side === 'original' ? rawUri : session.diffContext.counterpartUri;
      const modifiedUri = session.diffContext.side === 'modified' ? rawUri : session.diffContext.counterpartUri;
      return { mode: 'openDiffPair', fileUri, originalUri, modifiedUri };
    }

    // Regular editor view
    return { mode: 'workingTree', fileUri: fileUri ?? rawUri };
  }

  /**
   * Resolve a normalized diff pair from the given spec.
   */
  async resolvePair(spec: DiffSourceSpec): Promise<NormalizedDiffPair | null> {
    switch (spec.mode) {
      case 'workingTree':
        return this.resolveWorkingTree(spec);
      case 'revisionSelection':
        return this.resolveRevisionSelection(spec);
      case 'openDiffPair':
        return this.resolveOpenDiffPair(spec);
      default:
        return null;
    }
  }

  private async resolveWorkingTree(spec: DiffSourceSpec): Promise<NormalizedDiffPair | null> {
    try {
      const document = await vscode.workspace.openTextDocument(spec.fileUri);
      const currentModel = await this.renderer.renderDocumentToViewModel(document, {
        mode: 'webview', trusted: vscode.workspace.isTrusted,
      });

      const gitApi = await getGitApi();
      const comparison = await resolveGitWorkingTreeComparison(spec.fileUri, gitApi);

      if (comparison.mode === 'compare' && comparison.baseUri) {
        const baseDocument = await vscode.workspace.openTextDocument(comparison.baseUri);
        const baseModel = await this.renderer.renderDocumentToViewModel(baseDocument, {
          mode: 'webview', trusted: vscode.workspace.isTrusted,
        });
        this.applyBothSideDiffs(baseModel, currentModel, 'Export');
        return { baseModel, currentModel, spec };
      }

      if (comparison.mode === 'added') {
        currentModel.diff = buildAllAddedPresentation(currentModel, 'New file');
        const emptyBase = this.emptyModel(currentModel);
        return { baseModel: emptyBase, currentModel, spec };
      }

      // Clean file — no diff
      return { baseModel: this.emptyModel(currentModel), currentModel, spec };
    } catch (error) {
      this.trace.error(error instanceof Error ? error : String(error));
      return null;
    }
  }

  private async resolveRevisionSelection(spec: DiffSourceSpec): Promise<NormalizedDiffPair | null> {
    try {
      const gitApi = await getGitApi();
      if (!gitApi) {
        vscode.window.showErrorMessage('Git extension not available for revision comparison.');
        return null;
      }

      // Resolve previous side
      const baseDoc = await this.resolveRevisionDocument(spec.fileUri, spec.previousToken ?? 'most-recent-commit', gitApi);
      if (!baseDoc) {
        vscode.window.showErrorMessage(`Could not resolve previous version: ${spec.previousToken}`);
        return null;
      }

      // Resolve new/modified side
      const currentDoc = await this.resolveRevisionDocument(spec.fileUri, spec.newToken ?? 'current-changes', gitApi);
      if (!currentDoc) {
        vscode.window.showErrorMessage(`Could not resolve new version: ${spec.newToken}`);
        return null;
      }

      const baseModel = await this.renderer.renderDocumentToViewModel(baseDoc, {
        mode: 'webview', trusted: vscode.workspace.isTrusted,
      });
      const currentModel = await this.renderer.renderDocumentToViewModel(currentDoc, {
        mode: 'webview', trusted: vscode.workspace.isTrusted,
      });

      this.applyBothSideDiffs(baseModel, currentModel, 'Export');
      return { baseModel, currentModel, spec };
    } catch (error) {
      this.trace.error(error instanceof Error ? error : String(error));
      return null;
    }
  }

  private async resolveOpenDiffPair(spec: DiffSourceSpec): Promise<NormalizedDiffPair | null> {
    try {
      // Find the open diff context from the active session
      const session = this.provider.getActiveSession();
      if (!session) return null;

      let originalUri: vscode.Uri;
      let modifiedUri: vscode.Uri;

      if (session.diffContext) {
        originalUri = session.diffContext.side === 'original' ? session.document.uri : session.diffContext.counterpartUri;
        modifiedUri = session.diffContext.side === 'modified' ? session.document.uri : session.diffContext.counterpartUri;
      } else {
        // Try to detect diff tabs for the current document
        const diffTab = resolveDiffTabContext(session.document.uri);
        if (diffTab) {
          originalUri = diffTab.side === 'original' ? session.document.uri : diffTab.counterpartUri;
          modifiedUri = diffTab.side === 'modified' ? session.document.uri : diffTab.counterpartUri;
        } else {
          return null;
        }
      }

      const originalDoc = await vscode.workspace.openTextDocument(originalUri);
      const modifiedDoc = await vscode.workspace.openTextDocument(modifiedUri);

      const baseModel = await this.renderer.renderDocumentToViewModel(originalDoc, {
        mode: 'webview', trusted: vscode.workspace.isTrusted,
      });
      const currentModel = await this.renderer.renderDocumentToViewModel(modifiedDoc, {
        mode: 'webview', trusted: vscode.workspace.isTrusted,
      });

      this.applyBothSideDiffs(baseModel, currentModel, 'Export');
      return { baseModel, currentModel, spec };
    } catch (error) {
      this.trace.error(error instanceof Error ? error : String(error));
      return null;
    }
  }

  private async resolveRevisionDocument(
    fileUri: vscode.Uri,
    token: RevisionToken,
    gitApi: GitApiLike,
  ): Promise<vscode.TextDocument | null> {
    if (token === 'current-changes') {
      // Use the current on-disk file
      return vscode.workspace.openTextDocument(fileUri);
    }

    const ref = token === 'most-recent-commit' ? 'HEAD' : token;
    try {
      const gitUri = gitApi.toGitUri(fileUri, ref);
      return await vscode.workspace.openTextDocument(gitUri);
    } catch {
      return null;
    }
  }

  private emptyModel(template: RenderViewModel): RenderViewModel {
    return { ...template, html: '', blocks: {}, blockMap: [], diff: undefined };
  }

  /**
   * Build diff presentations for BOTH sides and assign them.
   * This ensures baseModel.diff.blocks has entries for deleted content
   * (blocks that only exist in the base model), which the card builder
   * and AI excerpt extraction need to find previous-side content.
   */
  private applyBothSideDiffs(baseModel: RenderViewModel, currentModel: RenderViewModel, label: string): void {
    const { original, modified } = buildSideBySideDiffPresentations(baseModel, currentModel, label);
    currentModel.diff = modified;
    baseModel.diff = original;
  }
}
