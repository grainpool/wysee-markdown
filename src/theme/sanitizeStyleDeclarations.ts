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

const blockedPatterns = [/[@{}]/, /expression\s*\(/i, /javascript:/i];

export function sanitizeStyleDeclarations(input: string): string {
  if (!input) {
    return '';
  }
  const cleanedParts: string[] = [];
  for (const piece of input.split(';')) {
    const trimmed = piece.trim();
    if (!trimmed) {
      continue;
    }
    if (blockedPatterns.some((pattern) => pattern.test(trimmed))) {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const property = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!/^[a-zA-Z-]+$/.test(property) || !value) {
      continue;
    }
    cleanedParts.push(`${property}: ${value}`);
  }
  return cleanedParts.join('; ');
}
