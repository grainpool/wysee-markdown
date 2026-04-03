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

import * as vscode from 'vscode';
import { VIEWTYPE_EDITOR, CTX } from '../constants';
import { ContextStateService } from '../editor/contextState';
import { ThemeService } from '../theme/themeService';
import { PageProfileService } from '../theme/pageProfileService';
import { BrowserPrintTransportManager } from '../print/browserPrintTransportManager';
import { WyseeEditorProvider } from '../editor/wyseeEditorProvider';

export class ContextInspector {
  constructor(
    private readonly provider: WyseeEditorProvider,
    private readonly contextState: ContextStateService,
    private readonly themeService: ThemeService,
    private readonly pageProfileService: PageProfileService,
    private readonly transportManager: BrowserPrintTransportManager,
  ) {}

  async inspect(): Promise<Record<string, unknown>> {
    const session = this.provider.getActiveSession();
    const uri = session?.document.uri;
    const theme = await this.themeService.getActiveTheme(uri);
    const pageProfile = await this.pageProfileService.getActivePageProfile(uri);
    const config = uri ? vscode.workspace.getConfiguration('wyseeMd', uri) : vscode.workspace.getConfiguration('wyseeMd');
    const editable = config.get<boolean>('preview.editable', true);
    const browserPrintAvailable = vscode.workspace.isTrusted;
    return {
      activeEditorUri: uri?.toString(),
      activeCustomEditorId: session ? VIEWTYPE_EDITOR : undefined,
      activeSessionId: session?.sessionId,
      currentBlockKind: session?.state.contextBlockKind ?? session?.state.focusedBlockKind,
      currentContextWord: session?.state.contextWord,
      selectionState: { hasSelection: session?.state.hasSelection, selectionText: session?.state.selectionText },
      currentThemeId: theme.id,
      currentPageProfileId: pageProfile.id,
      browserPrintAvailable,
      workspaceTrusted: vscode.workspace.isTrusted,
      contextKeys: {
        [CTX.editorActive]: Boolean(session),
        [CTX.editorEditable]: editable,
        [CTX.spellMisspelled]: Boolean(session?.state.contextWord),
        [CTX.blockKind]: session?.state.contextBlockKind ?? session?.state.focusedBlockKind ?? '',
        [CTX.hasSelection]: Boolean(session?.state.hasSelection),
        [CTX.browserPrintAvailable]: browserPrintAvailable,
      },
      visibilityReasons: {
        printVisible: Boolean(session) && browserPrintAvailable,
        savePdfVisible: Boolean(session) && browserPrintAvailable,
        themeVisible: Boolean(session),
        sourceVisible: Boolean(session),
        previewSpellActionsVisible: Boolean(session?.state.contextWord),
        blockInsertVisible: Boolean(session),
      },
      transportResolution: this.transportManager.resolveAdapterName(),
    };
  }
}
