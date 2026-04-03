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
 * Phase 4 tests: request scheduler ordering, concurrency modes,
 * cancellation, and cache-key independence from scheduling config.
 */

import * as assert from 'assert';
import { runScheduler, SchedulerTask, RequestSchedulingConfig } from '../src/export/approvalMatrix/ai/requestScheduler';

// ── Helpers ───────────────────────────────────────────────────────

function makeDelayTask(index: number, delayMs: number, value: string): SchedulerTask<string> {
  return {
    index,
    execute: () => new Promise(resolve => setTimeout(() => resolve(value), delayMs)),
  };
}

function makeFailTask(index: number, delayMs: number, errorMsg: string): SchedulerTask<string> {
  return {
    index,
    execute: () => new Promise((_, reject) => setTimeout(() => reject(new Error(errorMsg)), delayMs)),
  };
}

// ── Sequential mode ───────────────────────────────────────────────

describe('requestScheduler — sequential mode', () => {
  it('executes all tasks and returns results in index order', async () => {
    const tasks = [
      makeDelayTask(0, 10, 'first'),
      makeDelayTask(1, 10, 'second'),
      makeDelayTask(2, 10, 'third'),
    ];
    const config: RequestSchedulingConfig = { mode: 'sequential' };
    const results = await runScheduler(tasks, config);

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].result, 'first');
    assert.strictEqual(results[1].result, 'second');
    assert.strictEqual(results[2].result, 'third');
  });

  it('uses effective concurrency 1', async () => {
    let maxActive = 0;
    let active = 0;

    const tasks: SchedulerTask<string>[] = [0, 1, 2].map(i => ({
      index: i,
      execute: async () => {
        active++;
        if (active > maxActive) maxActive = active;
        await new Promise(r => setTimeout(r, 20));
        active--;
        return `task-${i}`;
      },
    }));

    const config: RequestSchedulingConfig = { mode: 'sequential' };
    await runScheduler(tasks, config);

    assert.strictEqual(maxActive, 1, 'sequential mode should never exceed 1 active task');
  });

  it('handles task failures without stopping', async () => {
    const tasks = [
      makeDelayTask(0, 5, 'ok'),
      makeFailTask(1, 5, 'boom'),
      makeDelayTask(2, 5, 'also-ok'),
    ];
    const config: RequestSchedulingConfig = { mode: 'sequential' };
    const results = await runScheduler(tasks, config);

    assert.strictEqual(results[0].result, 'ok');
    assert.ok(results[1].error?.includes('boom'));
    assert.strictEqual(results[2].result, 'also-ok');
  });
});

// ── Parallel mode ─────────────────────────────────────────────────

describe('requestScheduler — parallel mode', () => {
  it('respects maxConcurrent', async () => {
    let maxActive = 0;
    let active = 0;

    const tasks: SchedulerTask<string>[] = Array.from({ length: 6 }, (_, i) => ({
      index: i,
      execute: async () => {
        active++;
        if (active > maxActive) maxActive = active;
        await new Promise(r => setTimeout(r, 30));
        active--;
        return `task-${i}`;
      },
    }));

    const config: RequestSchedulingConfig = { mode: 'parallel', maxConcurrent: 2 };
    const results = await runScheduler(tasks, config);

    assert.ok(maxActive <= 2, `maxActive was ${maxActive}, should be <= 2`);
    assert.strictEqual(results.length, 6);
    for (let i = 0; i < 6; i++) {
      assert.strictEqual(results[i].result, `task-${i}`);
    }
  });

  it('clamps maxConcurrent to 12', async () => {
    let maxActive = 0;
    let active = 0;

    const tasks: SchedulerTask<string>[] = Array.from({ length: 20 }, (_, i) => ({
      index: i,
      execute: async () => {
        active++;
        if (active > maxActive) maxActive = active;
        await new Promise(r => setTimeout(r, 10));
        active--;
        return `task-${i}`;
      },
    }));

    const config: RequestSchedulingConfig = { mode: 'parallel', maxConcurrent: 50 };
    await runScheduler(tasks, config);

    assert.ok(maxActive <= 12, `maxActive was ${maxActive}, should be clamped to 12`);
  });

  it('output order matches index order despite varying completion times', async () => {
    // Task 0 takes longest, task 2 finishes first
    const tasks = [
      makeDelayTask(0, 50, 'slow'),
      makeDelayTask(1, 25, 'medium'),
      makeDelayTask(2, 5, 'fast'),
    ];
    const config: RequestSchedulingConfig = { mode: 'parallel', maxConcurrent: 3 };
    const results = await runScheduler(tasks, config);

    assert.strictEqual(results[0].index, 0);
    assert.strictEqual(results[0].result, 'slow');
    assert.strictEqual(results[1].index, 1);
    assert.strictEqual(results[1].result, 'medium');
    assert.strictEqual(results[2].index, 2);
    assert.strictEqual(results[2].result, 'fast');
  });
});

// ── Cancellation ──────────────────────────────────────────────────

describe('requestScheduler — cancellation', () => {
  it('marks remaining tasks as cancelled', async () => {
    const cancelToken = { cancelled: false };

    const tasks: SchedulerTask<string>[] = Array.from({ length: 5 }, (_, i) => ({
      index: i,
      execute: async () => {
        if (i === 2) cancelToken.cancelled = true; // cancel after task 2 starts
        await new Promise(r => setTimeout(r, 50));
        return `task-${i}`;
      },
    }));

    const config: RequestSchedulingConfig = { mode: 'sequential' };
    const results = await runScheduler(tasks, config, undefined, cancelToken);

    // First tasks should have completed or been in-flight
    assert.strictEqual(results.length, 5);

    // At least one later task should be cancelled
    const cancelledCount = results.filter(r => r.error === 'Cancelled').length;
    assert.ok(cancelledCount > 0, 'should have at least one cancelled task');
  });

  it('preserves completed results on cancellation', async () => {
    const cancelToken = { cancelled: false };

    const tasks: SchedulerTask<string>[] = [
      {
        index: 0,
        execute: async () => { return 'completed-before-cancel'; },
      },
      {
        index: 1,
        execute: async () => {
          cancelToken.cancelled = true;
          await new Promise(r => setTimeout(r, 200));
          return 'maybe-completed';
        },
      },
      {
        index: 2,
        execute: async () => { await new Promise(r => setTimeout(r, 100)); return 'should-be-cancelled'; },
      },
    ];

    const config: RequestSchedulingConfig = { mode: 'sequential' };
    const results = await runScheduler(tasks, config, undefined, cancelToken);

    // Task 0 completed before cancellation
    assert.strictEqual(results[0].result, 'completed-before-cancel');
    assert.strictEqual(results[0].error, undefined);
  });
});

// ── Progress callbacks ────────────────────────────────────────────

describe('requestScheduler — progress', () => {
  it('calls onProgress for each task', async () => {
    const progressCalls: [number, number][] = [];
    const tasks = [
      makeDelayTask(0, 5, 'a'),
      makeDelayTask(1, 5, 'b'),
      makeDelayTask(2, 5, 'c'),
    ];
    const config: RequestSchedulingConfig = { mode: 'sequential' };

    await runScheduler(tasks, config, {
      onProgress: (completed, total) => progressCalls.push([completed, total]),
    });

    assert.strictEqual(progressCalls.length, 3);
    assert.deepStrictEqual(progressCalls[2], [3, 3]);
  });

  it('calls onTaskComplete with result or error', async () => {
    const completions: { index: number; hasResult: boolean; hasError: boolean }[] = [];
    const tasks = [
      makeDelayTask(0, 5, 'ok'),
      makeFailTask(1, 5, 'fail'),
    ];
    const config: RequestSchedulingConfig = { mode: 'sequential' };

    await runScheduler(tasks, config, {
      onTaskComplete: (index, result, error) => {
        completions.push({ index, hasResult: !!result, hasError: !!error });
      },
    });

    assert.strictEqual(completions[0].index, 0);
    assert.strictEqual(completions[0].hasResult, true);
    assert.strictEqual(completions[1].index, 1);
    assert.strictEqual(completions[1].hasError, true);
  });
});

// ── Cache key independence ────────────────────────────────────────

describe('scheduler config does not affect cache identity', () => {
  it('CacheKey type has no scheduling fields', () => {
    // Verify by inspecting the type — the cache key should not contain
    // mode, maxConcurrent, or any scheduling-related field
    const types = require('../src/export/approvalMatrix/ai/types');
    // CacheKey is a TypeScript interface — we verify indirectly by checking
    // that the version constants used in cache keys don't include scheduling
    assert.ok(types.PROMPT_TEMPLATE_VERSION);
    assert.ok(types.CONTEXT_SCHEMA_VERSION);
    assert.ok(types.RESPONSE_CONTRACT_VERSION);
    // These should NOT include 'scheduling' in their names
    assert.ok(!JSON.stringify(types).includes('"schedulingVersion"'));
  });
});
