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

import { BlockEditPayload } from '../types';

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'focus'; blockId?: string; blockKind?: string }
  | { type: 'blockClicked'; blockId: string; startLine: number; endLine: number }
  | { type: 'context'; blockId?: string; blockKind?: string; word?: string; hasSelection?: boolean; selectionText?: string; canInsertBlock?: boolean; insertAfterBlockId?: string | null }
  | { type: 'selection'; hasSelection: boolean; selectionText?: string }
  | { type: 'editBlock'; payload: BlockEditPayload }
  | { type: 'editBlockWithFootnotes'; blockId: string; documentVersion: number; mainContent: string; footnoteDefs: { label: string; blockId: string | null; raw: string }[] }
  | { type: 'toggleEditable' }
  | { type: 'openExternal'; href: string }
  | { type: 'insertAtBoundary'; afterBlockId: string | null; markdown: string }
  | { type: 'scrollSourceLine'; line: number }
  | { type: 'requestPreview'; markdown: string; requestId: string }
  | { type: 'syncScrollChanged'; enabled: boolean }
  | { type: 'editPanelState'; active: boolean; textareaFocused?: boolean }
  | { type: 'pasteClipboardImages'; target: 'editPanel' | 'selectedBlock'; blockId?: string; images: { dataUrl: string; mimeType: string }[] }
  | { type: 'reportDiffLayout'; measurements: { groupId: string; height: number }[] }
  | { type: 'reportViewport'; ratio: number }
  | { type: 'openDiffAtLine'; line: number }
  | { type: 'exportAction'; action: 'print' | 'savePdf' | 'style' | 'source' | 'exportApprovalMatrix' }
  | { type: 'undo' }
  | { type: 'redo' };

export type ExtensionToWebviewMessage =
  | { type: 'render'; model: unknown }
  | { type: 'setEditable'; editable: boolean }
  | { type: 'showInfo'; message: string }
  | { type: 'showError'; message: string }
  | { type: 'previewResult'; html: string; requestId: string }
  | { type: 'scrollToSourceLine'; line: number }
  | { type: 'scrollToBlock'; blockId: string }
  | { type: 'highlightBlock'; blockId: string }
  | { type: 'insertTemplateIntoTextarea'; text: string }
  | { type: 'applyDiffLayout'; measurements: { groupId: string; height: number }[] }
  | { type: 'syncViewport'; ratio: number }
  | { type: 'setSyncScroll'; enabled: boolean }
  | { type: 'openFind' };
