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
 * AiSummaryCache — Phase 2
 *
 * In-memory cache for normalized summary results.
 * Cache keys now include context schema, response contract, and Git context versions
 * to prevent stale reuse when prompt/contract shape changes.
 */

import * as crypto from 'crypto';
import { CacheKey, NormalizedSummaryResult } from './types';

interface CacheEntry {
  result: NormalizedSummaryResult;
  timestamp: number;
}

export class AiSummaryCache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxAge = 30 * 60 * 1000; // 30 minutes

  get(key: CacheKey): NormalizedSummaryResult | undefined {
    const hash = this.hashKey(key);
    const entry = this.store.get(hash);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.store.delete(hash);
      return undefined;
    }
    return entry.result;
  }

  set(key: CacheKey, result: NormalizedSummaryResult): void {
    this.store.set(this.hashKey(key), { result, timestamp: Date.now() });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private hashKey(key: CacheKey): string {
    const serialized = JSON.stringify([
      key.endpoint, key.model,
      key.promptTemplateVersion, key.contextSchemaVersion,
      key.responseContractVersion, key.gitContextVersion,
      key.contextHash, key.excerptHash,
      key.selectedRevisionHash, key.hunkProvenanceHash,
      key.promptShapingHash,
    ]);
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }
}

/** Build a stable hash from text content */
export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}
