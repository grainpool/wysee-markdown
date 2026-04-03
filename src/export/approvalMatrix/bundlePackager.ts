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
 * BundlePackager
 *
 * Packages the workbook and review HTML into a single zip bundle.
 * Uses jszip for packaging.
 */

export interface BundleEntry {
  filename: string;
  data: Buffer | string;
}

export async function packageBundle(entries: BundleEntry[]): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  for (const entry of entries) {
    zip.file(entry.filename, entry.data);
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return buffer;
}
