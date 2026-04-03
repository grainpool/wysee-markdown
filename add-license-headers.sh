#!/usr/bin/env bash
# add-license-headers.sh
# Inserts Apache 2.0 license headers into source files that don't already have one.
# Safe to run multiple times — skips files that already contain the header.

HEADER_TS='// Copyright 2025-2026 Grainpool Holdings LLC
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
// limitations under the License.'

HEADER_CSS='/* Copyright 2025-2026 Grainpool Holdings LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */'

SENTINEL="Grainpool Holdings LLC"

insert_header() {
  local file="$1"
  local header="$2"
  if head -5 "$file" | grep -q "$SENTINEL"; then
    echo "  SKIP: $file"
    return
  fi
  local content
  content=$(cat "$file")
  printf '%s\n\n%s\n' "$header" "$content" > "$file"
  echo "  ADDED: $file"
}

echo "=== Adding Apache 2.0 license headers ==="
find src/ test/ -name '*.ts' | sort | while read -r f; do insert_header "$f" "$HEADER_TS"; done
for f in media/*.js; do [ -f "$f" ] && insert_header "$f" "$HEADER_TS"; done
for f in media/*.css; do [ -f "$f" ] && insert_header "$f" "$HEADER_CSS"; done
echo "=== Done ==="
