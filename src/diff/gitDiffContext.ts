import * as path from 'path';
import * as vscode from 'vscode';

export const enum GitStatus {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,
  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  INTENT_TO_RENAME,
  TYPE_CHANGED,
  ADDED_BY_US,
  ADDED_BY_THEM,
  DELETED_BY_US,
  DELETED_BY_THEM,
  BOTH_ADDED,
  BOTH_DELETED,
  BOTH_MODIFIED,
}

export interface GitChangeLike {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri?: vscode.Uri | undefined;
  readonly status: GitStatus;
}

export interface GitRepositoryLike {
  readonly state: {
    readonly mergeChanges: GitChangeLike[];
    readonly indexChanges: GitChangeLike[];
    readonly workingTreeChanges: GitChangeLike[];
    readonly untrackedChanges: GitChangeLike[];
    readonly onDidChange: vscode.Event<void>;
  };
}

export interface GitApiLike {
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
  getRepository(uri: vscode.Uri): GitRepositoryLike | null;
  readonly repositories?: GitRepositoryLike[];
  readonly onDidOpenRepository?: vscode.Event<GitRepositoryLike>;
  readonly onDidCloseRepository?: vscode.Event<GitRepositoryLike>;
}

interface GitExtensionLike {
  enabled?: boolean;
  getAPI(version: 1): GitApiLike;
}

export interface DiffTabContext {
  side: 'original' | 'modified';
  counterpartUri: vscode.Uri;
  groupViewColumn?: vscode.ViewColumn;
}

export interface GitWorkingTreeComparison {
  mode: 'none' | 'compare' | 'added' | 'conflict';
  label: string;
  baseUri?: vscode.Uri;
}


interface ParsedGitUri {
  path: string;
  ref: string;
  submoduleOf?: string;
}

export function isGitUriLike(uri: vscode.Uri | undefined): boolean {
  return Boolean(uri && uri.scheme === 'git');
}

export function parseGitUri(uri: vscode.Uri | undefined): ParsedGitUri | undefined {
  if (!uri || !isGitUriLike(uri) || !uri.query) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(uri.query) as { path?: unknown; ref?: unknown; submoduleOf?: unknown };
    if (typeof parsed.path !== 'string' || typeof parsed.ref !== 'string') {
      return undefined;
    }
    return {
      path: parsed.path,
      ref: parsed.ref,
      submoduleOf: typeof parsed.submoduleOf === 'string' ? parsed.submoduleOf : undefined,
    };
  } catch {
    return undefined;
  }
}

export function getBackingFileUri(uri: vscode.Uri | undefined): vscode.Uri | undefined {
  if (!uri) {
    return undefined;
  }
  if (uri.scheme === 'file') {
    return uri;
  }
  const parsed = parseGitUri(uri);
  return parsed ? vscode.Uri.file(parsed.path) : undefined;
}

export function getResourceIdentityKey(uri: vscode.Uri | undefined): string | undefined {
  const backing = getBackingFileUri(uri);
  if (!backing) {
    return undefined;
  }
  let normalized = path.normalize(backing.fsPath || backing.path);
  if (process.platform === 'win32') {
    normalized = normalized.toLowerCase();
  }
  return normalized;
}

export async function getGitApi(): Promise<GitApiLike | undefined> {
  const gitExtension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
  if (!gitExtension) {
    return undefined;
  }
  const exports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  if (!exports?.getAPI) {
    return undefined;
  }
  try {
    return exports.getAPI(1);
  } catch {
    return undefined;
  }
}

export function resolveDiffTabContext(uri: vscode.Uri, panelViewColumn?: vscode.ViewColumn): DiffTabContext | undefined {
  const scopedGroups = vscode.window.tabGroups.all.filter(group => panelViewColumn === undefined || group.viewColumn === panelViewColumn);
  const candidates = collectDiffTabCandidates(uri, scopedGroups);

  if (!candidates.length && (panelViewColumn === undefined || uri.scheme !== 'file') && scopedGroups.length !== vscode.window.tabGroups.all.length) {
    candidates.push(...collectDiffTabCandidates(uri, vscode.window.tabGroups.all));
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function collectDiffTabCandidates(
  uri: vscode.Uri,
  groups: readonly vscode.TabGroup[],
): Array<DiffTabContext & { score: number }> {
  const candidates: Array<DiffTabContext & { score: number }> = [];

  for (const group of groups) {
    for (const tab of group.tabs) {
      const input = tab.input as { original?: vscode.Uri; modified?: vscode.Uri } | undefined;
      if (!input?.original || !input?.modified) {
        continue;
      }
      if (uriEquals(input.original, uri)) {
        candidates.push({ side: 'original', counterpartUri: input.modified, groupViewColumn: group.viewColumn, score: tab.isActive ? 3 : group.isActive ? 2 : 1 });
      } else if (uriEquals(input.modified, uri)) {
        candidates.push({ side: 'modified', counterpartUri: input.original, groupViewColumn: group.viewColumn, score: tab.isActive ? 3 : group.isActive ? 2 : 1 });
      }
    }
  }

  return candidates;
}

export async function resolveGitWorkingTreeComparison(uri: vscode.Uri, gitApi?: GitApiLike): Promise<GitWorkingTreeComparison> {
  if (uri.scheme !== 'file') {
    return { mode: 'none', label: 'No Git comparison' };
  }
  const api = gitApi ?? await getGitApi();
  if (!api) {
    return { mode: 'none', label: 'No Git comparison' };
  }
  const repository = api.getRepository(uri);
  if (!repository) {
    return { mode: 'none', label: 'No Git comparison' };
  }

  const workingTreeChange = findChange(repository.state.workingTreeChanges, uri);
  const indexChange = findChange(repository.state.indexChanges, uri);
  const mergeChange = findChange(repository.state.mergeChanges, uri);
  const untrackedChange = findChange(repository.state.untrackedChanges, uri);

  if (mergeChange) {
    if ([GitStatus.BOTH_ADDED, GitStatus.BOTH_MODIFIED, GitStatus.BOTH_DELETED, GitStatus.ADDED_BY_US, GitStatus.ADDED_BY_THEM, GitStatus.DELETED_BY_US, GitStatus.DELETED_BY_THEM].includes(mergeChange.status)) {
      return { mode: 'conflict', label: 'Merge conflict state' };
    }
  }

  if (workingTreeChange) {
    switch (workingTreeChange.status) {
      case GitStatus.MODIFIED:
        return { mode: 'compare', label: 'Working tree', baseUri: api.toGitUri(uri, '~') };
      case GitStatus.TYPE_CHANGED:
        return { mode: 'compare', label: 'Type changed', baseUri: api.toGitUri(workingTreeChange.originalUri ?? uri, 'HEAD') };
      case GitStatus.UNTRACKED:
      case GitStatus.INTENT_TO_ADD:
      case GitStatus.IGNORED:
        return { mode: 'added', label: 'Untracked' };
      case GitStatus.INTENT_TO_RENAME: {
        const source = indexChange?.originalUri ?? workingTreeChange.originalUri ?? uri;
        return { mode: 'compare', label: 'Renamed', baseUri: api.toGitUri(source, 'HEAD') };
      }
      default:
        break;
    }
  }

  if (untrackedChange) {
    return { mode: 'added', label: 'Untracked' };
  }

  if (indexChange) {
    switch (indexChange.status) {
      case GitStatus.INDEX_MODIFIED:
        return { mode: 'compare', label: 'Index', baseUri: api.toGitUri(indexChange.originalUri ?? uri, 'HEAD') };
      case GitStatus.INDEX_RENAMED:
      case GitStatus.INDEX_COPIED:
        return { mode: 'compare', label: 'Index', baseUri: api.toGitUri(indexChange.originalUri ?? uri, 'HEAD') };
      case GitStatus.INDEX_ADDED:
        return { mode: 'added', label: 'Index added' };
      default:
        break;
    }
  }

  return { mode: 'none', label: 'No Git comparison' };
}

export function uriEquals(left: vscode.Uri | undefined, right: vscode.Uri | undefined): boolean {
  return Boolean(left && right && left.toString() === right.toString());
}

function findChange(changes: readonly GitChangeLike[], uri: vscode.Uri): GitChangeLike | undefined {
  return changes.find(change => uriEquals(change.uri, uri) || uriEquals(change.renameUri, uri) || uriEquals(change.originalUri, uri));
}
