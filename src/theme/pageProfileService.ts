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
