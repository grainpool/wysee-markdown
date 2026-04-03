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
import { ThemeProfile } from '../types';
import { compileThemeToPreviewCss, compileThemeToPrintCss } from './styleCompiler';
import { TraceService } from '../diagnostics/trace';
import { StyleManager } from '../style/styleManager';

/**
 * ThemeService now delegates to StyleManager.  It keeps the same public
 * interface so that the renderer, print service, and other consumers
 * continue to work unchanged.
 */
export class ThemeService {
  readonly extensionPath: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly trace: TraceService,
    private readonly styleManager: StyleManager,
  ) {
    this.extensionPath = context.extensionPath;
  }

  async initialize(): Promise<void> {
    await this.styleManager.initialize();
  }

  async listThemes(uri?: vscode.Uri): Promise<ThemeProfile[]> {
    const styles = await this.styleManager.listStyles(uri);
    return styles.map((s) => this.styleManager.toLegacyTheme(s));
  }

  async getActiveTheme(uri?: vscode.Uri): Promise<ThemeProfile> {
    const style = await this.styleManager.getActiveStyle(uri);
    return this.styleManager.toLegacyTheme(style);
  }

  async getThemeById(id: string, uri?: vscode.Uri): Promise<ThemeProfile | undefined> {
    const styles = await this.styleManager.listStyles(uri);
    const style = styles.find((s) => s.id === id);
    return style ? this.styleManager.toLegacyTheme(style) : undefined;
  }

  async setActiveTheme(id: string, uri?: vscode.Uri): Promise<void> {
    await this.styleManager.setActiveStyle(id, uri);
  }

  compileThemeToPreviewCss(theme: ThemeProfile): string {
    return compileThemeToPreviewCss(theme);
  }

  compileThemeToPrintCss(theme: ThemeProfile, pageProfile: any): string {
    return compileThemeToPrintCss(theme, pageProfile);
  }
}
