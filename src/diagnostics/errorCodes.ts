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

export const ERROR_CODES = {
  versionMismatch: 'WMD-EDT-409',
  renderFailed: 'WMD-RND-500',
  securitySanitized: 'WMD-SEC-201',
  spellUnavailable: 'WMD-SPL-503',
  printBindFailed: 'WMD-PRN-101',
  printLaunchFailed: 'WMD-PRN-201',
  exportFailed: 'WMD-EXP-500',
  contextMissing: 'WMD-CTX-404',
  trustRequired: 'WMD-TRU-403',
} as const;
