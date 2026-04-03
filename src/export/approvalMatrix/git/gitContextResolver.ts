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
 * GitContextResolver — Phase 3
 *
 * Dedicated Git metadata resolver. Keeps DiffSourceResolver focused on
 * document materialization while this module handles:
 * - selected revision metadata (hash, message, tags)
 * - per-hunk touching-commit provenance via git log -L
 *
 * All Git failures are best-effort and non-fatal.
 */

import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { TraceService } from '../../../diagnostics/trace';
import {
  ExportApprovalMatrixSession,
  ExportHunkInfo,
  RevisionGitContext,
  SelectedRevisionContext,
  HunkGitContext,
} from '../types';
import { HunkLineSpan } from '../context/contextTypes';
import { AiContextConfig } from '../ai/types';

// ── Public API ──────────────────────────────────────────────────

export class GitContextResolver {
  constructor(private readonly trace: TraceService) {}

  /**
   * Resolve selected revision metadata for both comparison sides.
   * Returns undefined for non-Git comparisons.
   */
  async resolveSelectedRevisions(
    session: ExportApprovalMatrixSession,
    fileUri: vscode.Uri,
  ): Promise<SelectedRevisionContext | undefined> {
    const mode = session.diffSourceMode;
    if (!mode || mode === 'openDiffPair') return undefined;

    const cwd = this.resolveWorkingDir(fileUri);
    if (!cwd) return undefined;

    const previousToken = session.previousSourceLabel ?? 'most-recent-commit';
    const newerToken = session.modifiedSourceLabel ?? 'current-changes';

    const previous = await this.resolveOneRevision(previousToken, cwd);
    const newer = await this.resolveOneRevision(newerToken, cwd);

    this.trace.trace('Git revision context resolved', {
      previous: { token: previous.token, status: previous.status, hash: previous.hash?.slice(0, 7) },
      newer: { token: newer.token, status: newer.status, hash: newer.hash?.slice(0, 7) },
    });

    return { previous, newer };
  }

  /**
   * Resolve per-hunk touching commits for all hunks in the session.
   * Enriches hunk.gitContext in place. Best-effort — failures produce unresolved status.
   */
  async resolveHunkProvenance(
    session: ExportApprovalMatrixSession,
    fileUri: vscode.Uri,
    contextConfig: AiContextConfig,
  ): Promise<void> {
    if (!contextConfig.hunkCommitProvenance) return;

    const cwd = this.resolveWorkingDir(fileUri);
    if (!cwd) {
      for (const hunk of session.hunks) {
        hunk.gitContext = { status: 'not-applicable', touchingCommits: [], totalCount: 0 };
      }
      return;
    }

    const relPath = vscode.workspace.asRelativePath(fileUri, false);
    const limit = Math.max(1, Math.min(contextConfig.hunkCommitLimit ?? 10, 50));

    // Determine revision range for provenance
    const revCtx = session.selectedRevisionContext;
    const previousHash = revCtx?.previous?.hash;
    const newerHash = revCtx?.newer?.hash;
    const newerIsWorkingTree = revCtx?.newer?.isWorkingTree ?? false;

    // The committed reference for provenance: use HEAD when newer is working tree
    const committedRef = newerIsWorkingTree ? 'HEAD' : newerHash;

    for (const hunk of session.hunks) {
      try {
        const gitCtx = await this.resolveOneHunk(
          hunk, relPath, cwd, previousHash, committedRef, newerIsWorkingTree, limit,
        );
        hunk.gitContext = gitCtx;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.trace.trace('Hunk provenance failed', { hunkIndex: hunk.index, error: msg });
        hunk.gitContext = {
          status: 'unresolved', touchingCommits: [], totalCount: 0,
          unresolvedReason: msg,
        };
      }
    }
  }

  // ── Private: revision resolution ────────────────────────────────

  private async resolveOneRevision(token: string, cwd: string): Promise<RevisionGitContext> {
    if (token === 'current-changes') {
      return { token, status: 'working-tree', isWorkingTree: true };
    }

    const ref = token === 'most-recent-commit' ? 'HEAD' : token;

    try {
      // Resolve full hash and message
      const logOutput = await this.execGit(['log', '--format=%H|%s', '-1', ref], cwd);
      const parts = logOutput.trim().split('|');
      if (parts.length < 2 || !parts[0]) {
        return { token, status: 'unresolved', unresolvedReason: 'Could not resolve commit' };
      }

      const hash = parts[0];
      const message = parts.slice(1).join('|'); // message may contain |

      // Resolve tags
      let tags: string[] = [];
      try {
        const tagOutput = await this.execGit(['tag', '--points-at', hash], cwd);
        tags = tagOutput.trim().split('\n').filter(Boolean);
      } catch { /* tags are optional */ }

      return { token, status: 'resolved', hash, message, tags: tags.length ? tags : undefined };
    } catch (error) {
      return {
        token, status: 'unresolved',
        unresolvedReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Private: hunk provenance ────────────────────────────────────

  private async resolveOneHunk(
    hunk: ExportHunkInfo,
    relPath: string,
    cwd: string,
    previousHash: string | undefined,
    committedRef: string | undefined,
    newerIsWorkingTree: boolean,
    limit: number,
  ): Promise<HunkGitContext> {
    // Select spans based on hunk kind
    const spans = this.selectSpansForProvenance(hunk);
    if (!spans.length) {
      return { status: 'not-applicable', touchingCommits: [], totalCount: 0 };
    }

    if (!committedRef) {
      return {
        status: 'unresolved', touchingCommits: [], totalCount: 0,
        unresolvedReason: 'No committed reference for provenance',
      };
    }

    // Collect touching commits across all spans
    const allCommits = new Map<string, { hash: string; message: string }>();

    for (const span of spans) {
      try {
        const commits = await this.getLineRangeCommits(
          relPath, span, previousHash, committedRef, cwd,
        );
        for (const c of commits) {
          if (!allCommits.has(c.hash)) allCommits.set(c.hash, c);
        }
      } catch (error) {
        this.trace.trace('Span provenance failed', {
          hunkIndex: hunk.index,
          span: `${span.startLine}-${span.endLine}`,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other spans
      }
    }

    // Sort oldest → newest (git log -L returns newest first, we reverse)
    const sorted = [...allCommits.values()].reverse();
    const totalCount = sorted.length;
    const truncated = totalCount > limit;
    const touchingCommits = sorted.slice(0, limit).map(c => ({
      hash: c.hash, message: c.message,
    }));

    return {
      status: totalCount > 0 ? 'resolved' : 'unresolved',
      touchingCommits,
      totalCount,
      truncatedCount: truncated ? totalCount - limit : undefined,
      unresolvedReason: totalCount === 0 ? 'No touching commits found in range' : undefined,
    };
  }

  private selectSpansForProvenance(hunk: ExportHunkInfo): HunkLineSpan[] {
    const kind = hunk.kind;
    if (kind === 'added' || kind === 'modified') {
      return hunk.newLineSpans ?? [];
    }
    if (kind === 'deleted') {
      return hunk.previousLineSpans ?? [];
    }
    // mixed: union both sides
    return [...(hunk.newLineSpans ?? []), ...(hunk.previousLineSpans ?? [])];
  }

  private async getLineRangeCommits(
    relPath: string,
    span: HunkLineSpan,
    previousHash: string | undefined,
    committedRef: string,
    cwd: string,
  ): Promise<{ hash: string; message: string }[]> {
    // git log -L uses 1-based line numbers
    const startLine = span.startLine + 1;
    const endLine = span.endLine + 1;

    // Build range spec: previousHash..committedRef or just committedRef
    const rangeArg = previousHash ? `${previousHash}..${committedRef}` : committedRef;

    const args = [
      'log', '--format=%H|%s', '--no-patch',
      `-L`, `${startLine},${endLine}:${relPath}`,
      rangeArg,
    ];

    const output = await this.execGit(args, cwd);
    const commits: { hash: string; message: string }[] = [];

    for (const line of output.trim().split('\n')) {
      if (!line.trim()) continue;
      const idx = line.indexOf('|');
      if (idx < 0) continue;
      const hash = line.slice(0, idx);
      const message = line.slice(idx + 1);
      if (hash.length >= 6) commits.push({ hash, message });
    }

    return commits;
  }

  // ── Private: helpers ────────────────────────────────────────────

  private resolveWorkingDir(fileUri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(fileUri);
    return folder?.uri.fsPath;
  }

  private execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.execFile('git', args, { cwd, timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`git ${args[0]} failed: ${stderr || error.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
