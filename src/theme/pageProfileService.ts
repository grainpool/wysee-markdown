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
import { PageProfile, ThemeProfile } from '../types';
import { compileThemeToPrintCss } from './styleCompiler';
import { TraceService } from '../diagnostics/trace';
import { StyleManager } from '../style/styleManager';

/**
 * PageProfileService now delegates to StyleManager for print profiles.
 * Keeps the same public interface for backward compatibility.
 */
export class PageProfileService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly trace: TraceService,
    private readonly styleManager: StyleManager,
  ) {}

  async initialize(): Promise<void> {
    // StyleManager.initialize() handles directory creation
  }

  async listPageProfiles(uri?: vscode.Uri): Promise<PageProfile[]> {
    return this.styleManager.listPrintProfiles(uri);
  }

  async getActivePageProfile(uri?: vscode.Uri): Promise<PageProfile> {
    return this.styleManager.getActivePrintProfile(uri);
  }

  async setActivePageProfile(id: string, uri?: vscode.Uri): Promise<void> {
    await this.styleManager.setActivePrintProfile(id, uri);
  }

  compileThemeToPrintCss(theme: ThemeProfile, pageProfile: PageProfile): string {
    return compileThemeToPrintCss(theme, pageProfile);
  }
}
