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

export function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number): T {
  let handle: NodeJS.Timeout | undefined;
  return ((...args: Parameters<T>) => {
    if (handle) {
      clearTimeout(handle);
    }
    handle = setTimeout(() => fn(...args), delayMs);
  }) as T;
}
