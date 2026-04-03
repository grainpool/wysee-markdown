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
 * AiSummaryService — Phase 2
 *
 * Coordinates AI summary generation using the canonical context bundle,
 * raw markdown excerpts, and the new 4-field response contract.
 */

import { TraceService } from '../../../diagnostics/trace';
import { RenderViewModel } from '../../../types';
import { ExportApprovalMatrixSession, ExportHunkInfo } from '../types';
import {
  AiConfig, AiModelEntry, AiSummaryRequest, CacheKey, HunkSummaryResult,
  ManifestContext, NormalizedSummaryResult,
  PROMPT_TEMPLATE_VERSION, CONTEXT_SCHEMA_VERSION, RESPONSE_CONTRACT_VERSION, GIT_CONTEXT_VERSION,
} from './types';
import { AiConfigService } from './aiConfigService';
import { AiSummaryCache, hashText } from './aiSummaryCache';
import { summarizeHunk, SummarizeResult } from './llmProvider';
import { runScheduler, SchedulerTask, RequestSchedulingConfig } from './requestScheduler';

export class AiSummaryService {
  private readonly cache = new AiSummaryCache();

  constructor(
    private readonly configService: AiConfigService,
    private readonly trace: TraceService,
  ) {}

  async summarizeHunks(
    session: ExportApprovalMatrixSession,
    baseModel: RenderViewModel,
    currentModel: RenderViewModel,
    modelName: string,
    onProgress?: (completed: number, total: number) => void,
    cancelToken?: { cancelled: boolean },
  ): Promise<HunkSummaryResult[]> {
    const config = await this.configService.readConfig();
    const entry = config.models.find(m => m.name === modelName);
    if (!entry) {
      this.trace.warn('AI model not found in config', { modelName });
      return session.hunks.map((_, i) => ({ hunkIndex: i, summaryText: '', normalized: null, fromCache: false, error: 'Model not found' }));
    }

    if (!entry.endpoint || !entry.model) {
      return session.hunks.map((_, i) => ({ hunkIndex: i, summaryText: '', normalized: null, fromCache: false, error: 'Incomplete model config' }));
    }

    const manifest = await this.loadManifest(config);
    const pendingTasks: { index: number; request: AiSummaryRequest; cacheKey: CacheKey }[] = [];
    const results: HunkSummaryResult[] = new Array(session.hunks.length);

    for (let i = 0; i < session.hunks.length; i++) {
      const hunk = session.hunks[i];
      const row = session.rows[i];
      const request = buildAiRequest(hunk, row, session, baseModel, currentModel, config, manifest);
      const cacheKey = buildCacheKey(entry, request, config);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        results[i] = { hunkIndex: i, summaryText: cached.summary, normalized: cached, fromCache: true };
        continue;
      }
      pendingTasks.push({ index: i, request, cacheKey });
    }

    // Resolve scheduling config
    const scheduling: RequestSchedulingConfig = entry.requestScheduling
      ?? { mode: 'sequential' };

    this.trace.trace('AI scheduler', {
      mode: scheduling.mode,
      maxConcurrent: scheduling.maxConcurrent ?? (scheduling.mode === 'sequential' ? 1 : 3),
      cached: session.hunks.length - pendingTasks.length,
      pending: pendingTasks.length,
    });

    // Report cache hits as completed
    const cacheHits = session.hunks.length - pendingTasks.length;
    onProgress?.(cacheHits, session.hunks.length);

    // Build scheduler tasks
    const tasks: SchedulerTask<SummarizeResult>[] = pendingTasks.map(item => ({
      index: item.index,
      execute: async (signal: AbortSignal) => {
        return summarizeHunk(item.request, entry, config, signal);
      },
    }));

    // Run through scheduler
    const schedulerResults = await runScheduler(tasks, scheduling, {
      onTaskComplete: (index, result, error) => {
        const item = pendingTasks.find(t => t.index === index);
        if (result && item) {
          this.cache.set(item.cacheKey, result.normalized);
          this.trace.trace('AI prompt compiled', {
            hunkIndex: index,
            systemLength: result.compiledPrompt.systemMessage.length,
            userLength: result.compiledPrompt.userMessage.length,
          });
          this.trace.trace('AI raw response', {
            hunkIndex: index,
            responseLength: result.rawResponse.length,
            response: result.rawResponse.slice(0, 500),
          });
          results[index] = {
            hunkIndex: index,
            summaryText: result.normalized.summary,
            normalized: result.normalized,
            fromCache: false,
          };
        } else {
          if (error) this.trace.warn('AI hunk failed', { hunkIndex: index, error });
          results[index] = { hunkIndex: index, summaryText: '', normalized: null, fromCache: false, error: error ?? 'Unknown error' };
        }
      },
      onProgress: (completed, total) => {
        onProgress?.(cacheHits + completed, session.hunks.length);
      },
    }, cancelToken);

    // Fill gaps
    for (let i = 0; i < results.length; i++) {
      if (!results[i]) results[i] = { hunkIndex: i, summaryText: '', normalized: null, fromCache: false, error: 'Not processed' };
    }
    return results;
  }

  private async loadManifest(config: AiConfig): Promise<ManifestContext | null> {
    if (!config.context.manifestPath) return null;
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const workspaceFolders = (await import('vscode')).workspace.workspaceFolders;
      const base = workspaceFolders?.[0]?.uri.fsPath ?? '.';
      const fullPath = path.isAbsolute(config.context.manifestPath) ? config.context.manifestPath : path.join(base, config.context.manifestPath);
      return JSON.parse(await fs.readFile(fullPath, 'utf-8'));
    } catch { return null; }
  }
}

// ── Request building ────────────────────────────────────────────

function buildAiRequest(
  hunk: ExportHunkInfo,
  row: { meta: { sectionPath?: string; headingPathMarkdown?: string; breadcrumbDisplay?: string; contextJson?: string; changeKind: string } },
  session: ExportApprovalMatrixSession,
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
  config: AiConfig,
  manifest: ManifestContext | null,
): AiSummaryRequest {
  const bundle = hunk.context;
  const sectionMode = config.context.sectionContext?.mode ?? 'fullMarkdown';

  return {
    hunkId: hunk.id,
    hunkIndex: hunk.index,
    docPath: session.docPath,
    changeKind: hunk.kind,
    headingPathMarkdown: bundle?.headingPathMarkdown ?? row.meta.headingPathMarkdown ?? '',
    breadcrumbDisplay: bundle?.breadcrumbDisplay ?? row.meta.breadcrumbDisplay ?? '',
    fullMarkdownContext: sectionMode === 'fullMarkdown'
      ? (bundle?.fullMarkdownContext ?? '')
      : sectionMode === 'headingOnly'
        ? (bundle?.headingPathMarkdown ?? '')
        : '',
    previousExcerptMarkdown: extractHunkExcerptMarkdown(hunk, 'previous', baseModel, currentModel),
    newExcerptMarkdown: extractHunkExcerptMarkdown(hunk, 'current', baseModel, currentModel),
    selectedRevisionContext: session.selectedRevisionContext,
    hunkGitContext: hunk.gitContext,
    customFields: Object.keys(config.context.customFields ?? {}).length ? config.context.customFields : undefined,
    manifestContext: manifest && config.context.includeManifest ? manifest : undefined,
  };
}

/**
 * Extract raw markdown excerpts for a hunk side.
 * Phase 2 change: prefers block.raw over block.plainText.
 */
function extractHunkExcerptMarkdown(
  hunk: ExportHunkInfo,
  side: 'previous' | 'current',
  baseModel: RenderViewModel,
  currentModel: RenderViewModel,
): string {
  const diff = currentModel.diff;
  if (!diff?.blocks) return '';
  const parts: string[] = [];

  if (side === 'current') {
    for (const [blockId, decoration] of Object.entries(diff.blocks)) {
      if (decoration.groupId !== hunk.groupId || decoration.state === 'unchanged') continue;
      if (decoration.state === 'deleted') continue;
      const block = currentModel.blocks?.[blockId];
      if (block) parts.push(block.raw || block.plainText || '');
    }
  } else {
    for (const [blockId, decoration] of Object.entries(diff.blocks)) {
      if (decoration.groupId !== hunk.groupId || decoration.state === 'unchanged') continue;
      if (decoration.state === 'added') continue;
      if (decoration.state === 'modified' && decoration.counterpartBlockId) {
        const baseBlock = baseModel.blocks?.[decoration.counterpartBlockId];
        if (baseBlock) parts.push(baseBlock.raw || baseBlock.plainText || '');
      } else if (decoration.state === 'deleted') {
        const block = currentModel.blocks?.[blockId];
        if (block) parts.push(block.raw || block.plainText || '');
      }
    }
    if (baseModel.diff?.blocks) {
      for (const [blockId, baseDec] of Object.entries(baseModel.diff.blocks)) {
        if (baseDec.groupId !== hunk.groupId || baseDec.state === 'unchanged') continue;
        const baseBlock = baseModel.blocks?.[blockId];
        if (baseBlock) {
          const text = baseBlock.raw || baseBlock.plainText || '';
          if (text && !parts.includes(text)) parts.push(text);
        }
      }
    }
  }

  return parts.join('\n').slice(0, 4000);
}

// ── Cache key building ──────────────────────────────────────────

function buildCacheKey(entry: AiModelEntry, request: AiSummaryRequest, config: AiConfig): CacheKey {
  const promptShaping = [
    config.prompting.template,
    config.prompting.preamble ? 'pre' : '',
    config.prompting.postamble ? 'post' : '',
    config.context.sectionContext?.mode ?? 'fullMarkdown',
    String(entry.options?.temperature ?? 0.3),
  ].filter(Boolean).join('|');

  return {
    endpoint: entry.endpoint,
    model: entry.model,
    promptTemplateVersion: PROMPT_TEMPLATE_VERSION,
    contextSchemaVersion: CONTEXT_SCHEMA_VERSION,
    responseContractVersion: RESPONSE_CONTRACT_VERSION,
    gitContextVersion: GIT_CONTEXT_VERSION,
    contextHash: hashText(request.fullMarkdownContext + '|' + request.headingPathMarkdown),
    excerptHash: hashText(request.previousExcerptMarkdown + '|' + request.newExcerptMarkdown),
    selectedRevisionHash: hashText(JSON.stringify(request.selectedRevisionContext ?? '')),
    hunkProvenanceHash: hashText(JSON.stringify(request.hunkGitContext ?? '')),
    promptShapingHash: hashText(promptShaping),
  };
}
