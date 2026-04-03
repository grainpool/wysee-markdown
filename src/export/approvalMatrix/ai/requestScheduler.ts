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
 * RequestScheduler — Phase 4
 *
 * Single bounded-concurrency execution path for AI summary requests.
 * Sequential mode is effective concurrency 1. Parallel uses maxConcurrent.
 * Results are always written back by index — completion order does not
 * affect output order. Cancellation is cooperative.
 */

export interface RequestSchedulingConfig {
  mode: 'sequential' | 'parallel';
  maxConcurrent?: number;
}

export interface SchedulerTask<T> {
  index: number;
  execute: (signal: AbortSignal) => Promise<T>;
}

export interface SchedulerResult<T> {
  index: number;
  result?: T;
  error?: string;
}

export interface SchedulerCallbacks<T> {
  onTaskComplete?: (index: number, result: T | undefined, error: string | undefined) => void;
  onProgress?: (completed: number, total: number) => void;
}

/**
 * Execute tasks with bounded concurrency. Returns results in index order
 * regardless of completion order. Supports cooperative cancellation.
 */
export async function runScheduler<T>(
  tasks: SchedulerTask<T>[],
  config: RequestSchedulingConfig,
  callbacks?: SchedulerCallbacks<T>,
  cancelToken?: { cancelled: boolean },
): Promise<SchedulerResult<T>[]> {
  const maxConcurrent = resolveEffectiveConcurrency(config);
  const results: SchedulerResult<T>[] = new Array(tasks.length);
  let completed = 0;
  const total = tasks.length;

  // AbortController for cooperative cancellation
  const controller = new AbortController();

  // Monitor cancel token
  const cancelCheck = cancelToken
    ? setInterval(() => { if (cancelToken.cancelled) controller.abort(); }, 100)
    : undefined;

  const pending: Promise<void>[] = [];

  const processTask = async (task: SchedulerTask<T>) => {
    if (controller.signal.aborted) {
      results[task.index] = { index: task.index, error: 'Cancelled' };
      return;
    }

    try {
      const result = await task.execute(controller.signal);
      results[task.index] = { index: task.index, result };
      callbacks?.onTaskComplete?.(task.index, result, undefined);
    } catch (error) {
      if (controller.signal.aborted) {
        results[task.index] = { index: task.index, error: 'Cancelled' };
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        results[task.index] = { index: task.index, error: msg };
        callbacks?.onTaskComplete?.(task.index, undefined, msg);
      }
    }
    completed++;
    callbacks?.onProgress?.(completed, total);
  };

  for (const task of tasks) {
    if (controller.signal.aborted) {
      results[task.index] = { index: task.index, error: 'Cancelled' };
      completed++;
      continue;
    }

    const p = processTask(task);
    pending.push(p);

    if (pending.length >= maxConcurrent) {
      await Promise.race(pending);
      // Clean up settled promises
      for (let j = pending.length - 1; j >= 0; j--) {
        const settled = await Promise.race([
          pending[j].then(() => true),
          Promise.resolve(false),
        ]);
        if (settled) pending.splice(j, 1);
      }
    }
  }

  // Wait for remaining
  await Promise.allSettled(pending);

  // Clean up cancel monitor
  if (cancelCheck) clearInterval(cancelCheck);

  // Fill any gaps (shouldn't happen but defensive)
  for (let i = 0; i < results.length; i++) {
    if (!results[i]) {
      results[i] = { index: i, error: 'Not processed' };
    }
  }

  return results;
}

function resolveEffectiveConcurrency(config: RequestSchedulingConfig): number {
  if (config.mode === 'sequential') return 1;
  const max = config.maxConcurrent ?? 3;
  return Math.max(1, Math.min(max, 12));
}
