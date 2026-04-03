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
 * ApprovalMatrixOrchestrator — Stage 5
 *
 * Supports three diff source modes + optional AI-assisted summaries.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { TraceService } from '../../diagnostics/trace';
import { MarkdownRenderer } from '../../render/markdownRenderer';
import { WyseeEditorProvider } from '../../editor/wyseeEditorProvider';
import { getBackingFileUri } from '../../diff/gitDiffContext';
import {
  ApprovalMatrixSettings, DEFAULT_APPROVAL_STATUSES, HunkCardImages,
  CARD_WIDTH_DEFAULT, CARD_WIDTH_MIN, CARD_WIDTH_MAX, CARD_HEIGHT_MAX,
} from './types';
import { buildExportSession } from './exportSessionBuilder';
import { buildWorkbook } from './workbookBuilder';
import { buildReviewHtml } from './reviewHtmlBuilder';
import { buildCardHtmlPairs } from './cardHtmlBuilder';
import { captureCardImages } from './cardCaptureService';
import { packageBundle } from './bundlePackager';
import { DiffSourceResolver, DiffSourceSpec, NormalizedDiffPair, isValidRevisionToken } from '../diffSourceResolver';
import { AiConfigService } from './ai/aiConfigService';
import { AiSummaryService } from './ai/aiSummaryService';
import { GitContextResolver } from './git/gitContextResolver';
import { ManifestContext } from './ai/types';

export class ApprovalMatrixOrchestrator {
  private readonly resolver: DiffSourceResolver;
  private readonly gitResolver: GitContextResolver;

  constructor(
    private readonly provider: WyseeEditorProvider,
    private readonly renderer: MarkdownRenderer,
    private readonly trace: TraceService,
    private readonly aiConfigService?: AiConfigService,
    private readonly aiSummaryService?: AiSummaryService,
  ) {
    this.resolver = new DiffSourceResolver(provider, renderer, trace);
    this.gitResolver = new GitContextResolver(trace);
  }

  async exportApprovalMatrix(): Promise<void> {
    const session = this.provider.getActiveSession();
    if (!session) {
      vscode.window.showErrorMessage('No active Markdown document. Open a Markdown file in Wysee first.');
      return;
    }

    const rawUri = session.document.uri;
    const fileUri = getBackingFileUri(rawUri) ?? rawUri;

    // Detect the current context
    const context = this.resolver.detectCurrentContext();

    const settings = this.readSettings(fileUri);
    if (!settings.approvalStatuses.length) {
      vscode.window.showErrorMessage('Approval status list is empty. Configure wysee.approvalMatrix.approvalStatuses in settings.');
      return;
    }

    // Build the diff source spec via dialog
    const spec = await this.showExportDialog(context, fileUri, settings);
    if (!spec) return; // cancelled

    // Save-check: if current-changes is used and file is dirty, prompt to save
    if ((spec.previousToken === 'current-changes' || spec.newToken === 'current-changes') && spec.mode !== 'openDiffPair') {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === fileUri.fsPath);
      if (doc?.isDirty) {
        const choice = await vscode.window.showWarningMessage(
          'The active file has unsaved changes. Save before exporting?',
          { modal: true },
          'Save',
          'Cancel',
        );
        if (choice !== 'Save') return;
        await doc.save();
      }
    }

    // Resolve the normalized diff pair
    const pair = await this.resolver.resolvePair(spec);
    if (!pair) {
      vscode.window.showErrorMessage('Could not resolve the diff pair. Check that the file exists at the specified revisions.');
      return;
    }

    // Filenames
    const docStem = path.parse(path.basename(fileUri.fsPath)).name;
    const slug = docStem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const workbookFileName = `${slug}-approval-matrix.xlsx`;
    const reviewHtmlFileName = `${slug}-review.html`;
    const bundleFileName = `${slug}-approval-bundle.zip`;

    const savePath = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(path.dirname(fileUri.fsPath), bundleFileName)),
      filters: { 'Zip Bundle': ['zip'] },
      title: 'Export Approval Matrix Bundle',
    });
    if (!savePath) return;

    const hunkCount = pair.currentModel.diff?.hunks?.length ?? 0;
    if (hunkCount === 0) {
      const proceed = await vscode.window.showWarningMessage(
        'No change hunks detected. The bundle will be empty. Continue?',
        'Export anyway', 'Cancel',
      );
      if (proceed !== 'Export anyway') return;
    }

    // Open the file document for session building
    let fileDocument: vscode.TextDocument;
    try {
      fileDocument = await vscode.workspace.openTextDocument(fileUri);
    } catch {
      fileDocument = session.document;
    }

    const exportSession = buildExportSession(
      fileDocument, pair.baseModel, pair.currentModel, settings, spec.publishUrl ?? '',
    );

    // Add source metadata to session
    exportSession.diffSourceMode = spec.mode;
    exportSession.previousSourceLabel = spec.previousLabel;
    exportSession.modifiedSourceLabel = spec.newLabel;

    // AI toggle
    let aiEnabled = false;
    let aiModelName = '';
    if (this.aiConfigService && this.aiSummaryService && hunkCount > 0) {
      const aiResult = await this.showAiToggle();
      if (aiResult === null) return; // cancelled
      aiEnabled = aiResult.enabled;
      aiModelName = aiResult.modelName;
    }

    // Enrich with Git context if AI is enabled (or always for metadata)
    if (hunkCount > 0) {
      try {
        const revCtx = await this.gitResolver.resolveSelectedRevisions(exportSession, fileUri);
        if (revCtx) exportSession.selectedRevisionContext = revCtx;
      } catch (error) {
        this.trace.trace('Git revision context failed (non-fatal)', { error: String(error) });
      }

      if (aiEnabled && this.aiConfigService) {
        try {
          const config = await this.aiConfigService.readConfig();
          await this.gitResolver.resolveHunkProvenance(exportSession, fileUri, config.context);
        } catch (error) {
          this.trace.trace('Git hunk provenance failed (non-fatal)', { error: String(error) });
        }
      }
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Building approval matrix bundle\u2026', cancellable: aiEnabled },
      async (progress, token) => {
        try {
          let cardImages: HunkCardImages[] | undefined;
          const screenshotsHidden = settings.hiddenColumns.includes('screenshots');

          if (hunkCount > 0 && !screenshotsHidden) {
            progress.report({ message: 'Capturing hunk cards\u2026' });
            const userCss = (pair.currentModel.previewCss || '') + '\n' + (pair.currentModel.syntaxCss || '');
            const cardPairs = buildCardHtmlPairs(
              pair.baseModel, pair.currentModel,
              exportSession.hunks, settings.cardWidth, settings.cardMaxHeight, userCss,
            );
            cardImages = await captureCardImages(cardPairs, settings.cardWidth, settings.cardMaxHeight, this.trace);
          }

          // AI summaries
          if (aiEnabled && this.aiSummaryService && aiModelName) {
            progress.report({ message: `Generating AI summaries (0/${hunkCount})\u2026` });

            // Cooperative cancellation token
            const cancelToken = { cancelled: false };
            const cancelDisposable = token.onCancellationRequested(() => { cancelToken.cancelled = true; });

            try {
              const summaries = await this.aiSummaryService.summarizeHunks(
                exportSession, pair.baseModel, pair.currentModel, aiModelName,
                (completed, total) => {
                  progress.report({ message: `Generating AI summaries (${completed}/${total})\u2026` });
                },
                cancelToken,
              );

              // Check if cancelled during generation
              if (cancelToken.cancelled) {
                const choice = await vscode.window.showWarningMessage(
                  'AI summary generation was cancelled.',
                  'Discard', 'Export with existing summaries',
                );
                if (choice === 'Discard') {
                  cancelDisposable.dispose();
                  return;
                }
                // 'Export with existing summaries' — use whatever completed
              }

              for (const result of summaries) {
                if (result.hunkIndex < exportSession.rows.length) {
                  exportSession.rows[result.hunkIndex].summaryText = result.summaryText || '[summary]';
                }
              }
            } catch (error) {
              this.trace.warn('AI summary batch failed, continuing without AI', { error: String(error) });
              for (const row of exportSession.rows) {
                if (!row.summaryText) row.summaryText = '[summary]';
              }
            }
            cancelDisposable.dispose();
          }

          progress.report({ message: 'Building workbook\u2026' });
          const xlsxBuffer = await buildWorkbook(exportSession, cardImages);

          progress.report({ message: 'Building review HTML\u2026' });
          const reviewHtml = buildReviewHtml(pair.baseModel, pair.currentModel, exportSession);

          progress.report({ message: 'Packaging bundle\u2026' });
          const zipBuffer = await packageBundle([
            { filename: workbookFileName, data: xlsxBuffer },
            { filename: reviewHtmlFileName, data: reviewHtml },
          ]);

          await fs.writeFile(savePath.fsPath, zipBuffer);
        } catch (error) {
          this.trace.error(error instanceof Error ? error : String(error));
          throw error;
        }
      },
    );

    this.trace.info('Approval matrix bundle exported', {
      path: savePath.fsPath, hunks: hunkCount, rows: exportSession.rows.length, mode: spec.mode,
    });

    const action = await vscode.window.showInformationMessage(
      `Bundle exported: ${path.basename(savePath.fsPath)} (${exportSession.rows.length} change${exportSession.rows.length === 1 ? '' : 's'})`,
      'Open File', 'Open Folder',
    );
    if (action === 'Open File') await vscode.env.openExternal(savePath);
    else if (action === 'Open Folder') await vscode.env.openExternal(vscode.Uri.file(path.dirname(savePath.fsPath)));
  }

  /**
   * Show the export dialog appropriate to the context.
   * For repo-backed files: revision selection + publish URL.
   * For ad hoc diffs: informational summary + publish URL.
   */
  private async showExportDialog(
    context: ReturnType<DiffSourceResolver['detectCurrentContext']>,
    fileUri: vscode.Uri,
    settings: ApprovalMatrixSettings,
  ): Promise<(DiffSourceSpec & { publishUrl?: string }) | null> {
    if (context.mode === 'openDiffPair' && context.originalUri && context.modifiedUri) {
      // Ad hoc diff — show summary, just ask for publish URL
      const publishUrl = await vscode.window.showInputBox({
        title: 'Export Approval Matrix — Ad hoc diff',
        prompt: `Original: ${path.basename(context.originalUri.fsPath)}\nModified: ${path.basename(context.modifiedUri.fsPath)}\n\nEnter publish URL or leave blank for relative links.`,
        value: settings.publishUrl,
        placeHolder: 'https://docs.example.com/reviews/review.html',
      });
      if (publishUrl === undefined) return null;

      return {
        mode: 'openDiffPair',
        fileUri,
        previousLabel: context.originalUri.fsPath,
        newLabel: context.modifiedUri.fsPath,
        publishUrl: publishUrl.trim(),
      };
    }

    // Repo-backed file — revision selection via QuickPick
    const recentCommits = await this.getRecentCommits(fileUri, 15);

    // Build QuickPick items
    const items: vscode.QuickPickItem[] = [
      { label: '$(zap) Working tree diff', description: 'most-recent-commit → current-changes', detail: 'Compare the last commit against your current saved file' },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
    ];

    // Add recent commits as "compare FROM this commit"
    for (const commit of recentCommits) {
      items.push({
        label: commit.hash.slice(0, 8),
        description: commit.message,
        detail: commit.date,
      });
    }

    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(edit) Enter revisions manually\u2026', description: 'Paste commit hashes as a comma-separated pair' },
    );

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Export Approval Matrix — Select comparison',
      placeHolder: 'Choose a comparison mode or select a commit to compare from',
    });
    if (!picked) return null;

    let prevToken: string;
    let newToken: string;

    if (picked.label.includes('Working tree diff')) {
      prevToken = 'most-recent-commit';
      newToken = 'current-changes';
    } else if (picked.label.includes('Enter revisions manually')) {
      // Single input with comma-separated format
      const configPrev = vscode.workspace.getConfiguration('wysee.approvalMatrix', fileUri)
        .get<string>('defaultPreviousRevision', 'most-recent-commit');
      const configNew = vscode.workspace.getConfiguration('wysee.approvalMatrix', fileUri)
        .get<string>('defaultNewRevision', 'current-changes');

      const input = await vscode.window.showInputBox({
        title: 'Export Approval Matrix — Revisions',
        prompt: 'Enter two revisions separated by a comma: previous, new\nAllowed: most-recent-commit, current-changes, or a commit hash (6+ hex)',
        value: `${configPrev}, ${configNew}`,
        validateInput: (v) => {
          const parts = v.split(',').map(s => s.trim()).filter(Boolean);
          if (parts.length !== 2) return 'Enter exactly two values separated by a comma';
          for (const part of parts) {
            if (!isValidRevisionToken(part)) return `Invalid token: "${part}". Use most-recent-commit, current-changes, or a commit hash.`;
          }
          return null;
        },
      });
      if (input === undefined) return null;
      const parts = input.split(',').map(s => s.trim());
      prevToken = parts[0];
      newToken = parts[1];
    } else {
      // Selected a commit hash — show second picker for "compare against"
      prevToken = picked.label.trim();

      const compareItems: vscode.QuickPickItem[] = [
        { label: 'current-changes', description: 'Current saved file' },
        { label: 'most-recent-commit', description: 'HEAD' },
        { label: '', kind: vscode.QuickPickItemKind.Separator },
      ];
      for (const commit of recentCommits) {
        if (commit.hash.startsWith(prevToken)) continue; // skip the already-selected one
        compareItems.push({
          label: commit.hash.slice(0, 8),
          description: commit.message,
          detail: commit.date,
        });
      }

      const compareTarget = await vscode.window.showQuickPick(compareItems, {
        title: `Export Approval Matrix — Compare ${prevToken} against\u2026`,
        placeHolder: 'Select the new/target version',
      });
      if (!compareTarget) return null;
      newToken = compareTarget.label.trim();
    }

    // Warn if identical
    if (prevToken === newToken) {
      const proceed = await vscode.window.showWarningMessage(
        'Both versions are identical. The export will likely be empty.',
        'Continue', 'Cancel',
      );
      if (proceed !== 'Continue') return null;
    }

    const publishUrl = await vscode.window.showInputBox({
      title: 'Review HTML publish URL',
      prompt: 'Enter the future URL where the review HTML will be hosted, or leave blank for relative links.',
      value: settings.publishUrl,
      placeHolder: 'https://docs.example.com/reviews/review.html',
    });
    if (publishUrl === undefined) return null;

    const isWorkingTree = prevToken === 'most-recent-commit' && newToken === 'current-changes';

    return {
      mode: isWorkingTree ? 'workingTree' : 'revisionSelection',
      fileUri,
      previousToken: prevToken,
      newToken: newToken,
      previousLabel: prevToken,
      newLabel: newToken,
      publishUrl: publishUrl?.trim(),
    };
  }

  /**
   * Show AI model picker from YAML config.
   * Returns { enabled, modelName } or null if cancelled.
   */
  private async showAiToggle(): Promise<{ enabled: boolean; modelName: string } | null> {
    if (!this.aiConfigService) return { enabled: false, modelName: '' };

    const config = await this.aiConfigService.readConfigRaw();
    if (!config.models.length) {
      // No models configured — skip AI silently
      return { enabled: false, modelName: '' };
    }

    const items: vscode.QuickPickItem[] = [
      { label: '$(circle-slash) Continue without AI', description: 'Export with blank summaries' },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
    ];

    for (const m of config.models) {
      const isActive = m.name === config.activeModel;
      items.push({
        label: `$(sparkle) ${m.name}`,
        description: `${m.provider}/${m.model}${isActive ? ' (default)' : ''}`,
      });
    }

    items.push(
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      { label: '$(gear) Configure AI\u2026', description: 'Open ai-config.yaml' },
      { label: '$(key) Set API Secret\u2026', description: 'Store a secret for ${{ secrets.X }}' },
    );

    const picked = await vscode.window.showQuickPick(items, {
      title: 'AI-Assisted Summaries',
      placeHolder: 'Select a model for AI summaries or skip',
    });

    if (!picked) return null;
    if (picked.label.includes('Configure AI')) {
      await this.aiConfigService.scaffoldAndOpen();
      return { enabled: false, modelName: '' };
    }
    if (picked.label.includes('Set API Secret')) {
      await vscode.commands.executeCommand('wysee.approvalMatrix.ai.setSecret');
      return { enabled: false, modelName: '' };
    }
    if (picked.label.includes('Continue without AI')) {
      return { enabled: false, modelName: '' };
    }

    const pickedName = picked.label.replace(/^\$\([^)]+\)\s*/, '');
    return { enabled: true, modelName: pickedName };
  }

  private readSettings(uri: vscode.Uri): ApprovalMatrixSettings {
    const config = vscode.workspace.getConfiguration('wysee.approvalMatrix', uri);
    const rawWidth = config.get<number>('cardWidth', CARD_WIDTH_DEFAULT);
    return {
      publishUrl: config.get<string>('publishUrl', ''),
      approvalStatuses: config.get<string[]>('approvalStatuses', DEFAULT_APPROVAL_STATUSES),
      hiddenColumns: config.get<string[]>('hiddenColumns', []),
      changeIdPrefix: config.get<string>('changeIdPrefix', ''),
      cardWidth: Math.max(CARD_WIDTH_MIN, Math.min(CARD_WIDTH_MAX, rawWidth)),
      cardMaxHeight: Math.max(200, Math.min(CARD_HEIGHT_MAX, config.get<number>('cardMaxHeight', CARD_HEIGHT_MAX))),
    };
  }

  private async getRecentCommits(fileUri: vscode.Uri, count: number): Promise<{ hash: string; message: string; date: string }[]> {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);

      // Get the repo root
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
      const cwd = workspaceFolder?.uri.fsPath ?? path.dirname(fileUri.fsPath);
      const relativePath = path.relative(cwd, fileUri.fsPath);

      const { stdout } = await execFileAsync('git', [
        'log', `--max-count=${count}`, '--format=%H|%s|%ar', '--', relativePath,
      ], { cwd });

      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [hash, message, date] = line.split('|');
        return { hash: hash ?? '', message: message ?? '', date: date ?? '' };
      }).filter(c => c.hash.length >= 6);
    } catch {
      this.trace.trace('Could not fetch recent commits', { uri: fileUri.toString() });
      return [];
    }
  }
}
