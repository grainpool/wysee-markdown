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
