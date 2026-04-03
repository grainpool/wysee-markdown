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
 * Canonical hunk-context contracts.
 *
 * These types define the shared source of truth for section/breadcrumb
 * context across the workbook, card headers, hidden metadata, and AI
 * prompt compilation.
 */

export type HunkContextNodeRole =
  | 'heading'
  | 'tableHeader'
  | 'leadIn'
  | 'caption'
  | 'listContext'
  | 'codeContext'
  | 'calloutTitle'
  | 'blockTypeLabel'
  | 'opaqueMeta';

export type HunkContextNodeRelation = 'ancestor' | 'framing' | 'siblingHint';

export interface HunkContextNode {
  role: HunkContextNodeRole;
  relation: HunkContextNodeRelation;
  markdown: string;
  blockId?: string;
  side?: 'previous' | 'current' | 'shared';
  depth?: number;
  priority?: number;
  meta?: Record<string, string | number | boolean | null>;
}

export interface HunkLineSpan {
  startLine: number;
  endLine: number;
}

export interface HunkContextBundle {
  schemaVersion: '2.0.0';
  nodes: HunkContextNode[];
  headingPathMarkdown: string;
  breadcrumbDisplay: string;
  fullMarkdownContext: string;
  contextJson: string;
  contextRoles?: string;
}

export const CONTEXT_SCHEMA_VERSION = '2.0.0';
