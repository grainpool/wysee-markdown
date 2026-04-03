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
 * LlmProvider — Phase 2
 *
 * Generic chat/completions transport with tolerant JSON extraction.
 * Canonical consumed field is `summary`. Parser requires a usable
 * summary, tolerates missing reserved fields, ignores extras.
 */

import { AiModelEntry, AiSummaryRequest, NormalizedSummaryResult } from './types';
import { compilePrompt, CompiledPrompt } from './aiPromptCompiler';
import { AiConfig } from './types';

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export interface SummarizeResult {
  normalized: NormalizedSummaryResult;
  compiledPrompt: CompiledPrompt;
  rawResponse: string;
}

export async function testConnection(entry: AiModelEntry): Promise<TestConnectionResult> {
  if (!entry.endpoint.trim()) return { success: false, message: 'Endpoint URL is required' };
  if (!entry.model.trim()) return { success: false, message: 'Model is required' };

  const start = Date.now();
  try {
    const chatPath = (entry.chatPath ?? 'chat/completions').replace(/^\/+/, '');
    const url = `${entry.endpoint.replace(/\/+$/, '')}/${chatPath}`;
    const headers = buildHeaders(entry);
    const body = JSON.stringify({
      model: entry.model,
      messages: [{ role: 'user', content: 'Respond with: {"status":"ok"}' }],
      max_tokens: 20, temperature: 0,
      ...(entry.requestBody ?? {}),
    });

    const response = await fetchWithTimeout(url, { method: 'POST', headers, body }, entry.options?.timeout ?? 30000);
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, message: `HTTP ${response.status}: ${text.slice(0, 200)}`, latencyMs };
    }
    return { success: true, message: `Connected to ${entry.provider}/${entry.model} (${latencyMs}ms)`, latencyMs };
  } catch (error) {
    return { success: false, message: `Connection failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function summarizeHunk(
  request: AiSummaryRequest,
  entry: AiModelEntry,
  config: AiConfig,
  signal?: AbortSignal,
): Promise<SummarizeResult> {
  const compiled = compilePrompt(config, request);
  const chatPath = (entry.chatPath ?? 'chat/completions').replace(/^\/+/, '');
  const url = `${entry.endpoint.replace(/\/+$/, '')}/${chatPath}`;
  const headers = buildHeaders(entry);
  const maxRetries = entry.options?.maxRetries ?? 2;
  const backoff = entry.options?.retryBackoff ?? 1000;
  const timeout = entry.options?.timeout ?? 30000;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('Cancelled');
    if (attempt > 0) await sleep(backoff * attempt);
    try {
      const body = JSON.stringify({
        model: entry.model,
        messages: [
          { role: 'system', content: compiled.systemMessage },
          { role: 'user', content: compiled.userMessage },
        ],
        max_tokens: entry.options?.maxTokens ?? 2000,
        temperature: entry.options?.temperature ?? 0.3,
        ...(entry.requestBody ?? {}),
      });

      const response = await fetchWithTimeout(url, { method: 'POST', headers, body }, timeout, signal);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = await response.json() as any;
      const rawContent = extractResponseContent(data);
      const normalized = parseResponse(rawContent);
      return { normalized, compiledPrompt: compiled, rawResponse: rawContent };
    } catch (error) {
      if (signal?.aborted) throw new Error('Cancelled');
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error('AI request failed after retries');
}

// ── Response extraction ─────────────────────────────────────────

function extractResponseContent(data: any): string {
  return (
    data?.choices?.[0]?.message?.content ??
    data?.message?.content ??
    data?.response ??
    data?.output ??
    data?.text ??
    (typeof data?.content === 'string' ? data.content : '') ??
    ''
  );
}

// ── Parser ──────────────────────────────────────────────────────

export function parseResponse(content: string): NormalizedSummaryResult {
  // Strip thinking tags (Qwen, DeepSeek)
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Strip markdown code fences
  cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Extract the first JSON object
  let parsed: any = null;
  try {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
  } catch { /* not valid JSON */ }

  if (parsed && typeof parsed === 'object') {
    // Try canonical field first, then legacy aliases
    const summary =
      parsed.summary ??
      parsed.summary_of_change ??
      parsed.summary_of_changes ??
      parsed.description ??
      parsed.change_summary ??
      parsed.text ??
      '';

    const summaryText = (typeof summary === 'string' ? summary : String(summary)).trim();
    if (summaryText) {
      return {
        summary: summaryText,
        user_visible: typeof parsed.user_visible === 'boolean' ? parsed.user_visible : true,
        context_limited: typeof parsed.context_limited === 'boolean' ? parsed.context_limited : false,
        reviewer_flags: Array.isArray(parsed.reviewer_flags) ? parsed.reviewer_flags.map(String) : [],
      };
    }
  }

  // No usable summary found — this is a parse failure per contract
  throw new Error(`No usable summary in response: ${cleaned.slice(0, 200)}`);
}

// ── Helpers ─────────────────────────────────────────────────────

function buildHeaders(entry: AiModelEntry): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (entry.auth === 'bearer' && entry.apiKey) {
    headers['Authorization'] = `Bearer ${entry.apiKey}`;
  } else if (entry.auth === 'custom-header' && entry.authHeader && entry.apiKey) {
    headers[entry.authHeader] = entry.apiKey;
  }
  return headers;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, externalSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // If external signal fires, abort our controller too
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', onExternalAbort); }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
