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

export interface WyseeDirective {
  kind: 'page-break' | 'page-break-before' | 'page-break-after' | 'unknown';
  raw: string;
}

export function parseDirective(line: string): WyseeDirective | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('<!-- wysee:')) {
    return undefined;
  }
  if (trimmed === '<!-- wysee:page-break -->') {
    return { kind: 'page-break', raw: trimmed };
  }
  if (trimmed === '<!-- wysee:page-break-before -->') {
    return { kind: 'page-break-before', raw: trimmed };
  }
  if (trimmed === '<!-- wysee:page-break-after -->') {
    return { kind: 'page-break-after', raw: trimmed };
  }
  // Unknown directive — still recognized as a directive block, just not acted on
  return { kind: 'unknown', raw: trimmed };
}

export function renderDirectiveHint(line: string): string {
  const parsed = parseDirective(line);
  if (!parsed || parsed.kind === 'unknown') {
    return '';
  }
  const label = parsed.kind.replace(/-/g, ' ');
  return `<div class="wysee-directive-hint">${label}</div>`;
}

export function directivePrintClass(line: string): string | undefined {
  const parsed = parseDirective(line);
  if (!parsed) {
    return undefined;
  }
  switch (parsed.kind) {
    case 'page-break':
    case 'page-break-after':
      return 'wysee-page-break-after';
    case 'page-break-before':
      return 'wysee-page-break-before';
    default:
      return undefined;
  }
}
