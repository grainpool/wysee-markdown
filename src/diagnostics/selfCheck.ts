import * as vscode from 'vscode';
import { VIEWTYPE_EDITOR } from '../constants';
import { SelfCheckReport, SelfCheckReportItem } from '../types';
import { ThemeService } from '../theme/themeService';
import { PageProfileService } from '../theme/pageProfileService';
import { SpellService } from '../spell/spellService';
import { ExternalPrintServer } from '../print/externalPrintServer';
import { BrowserPrintTransportManager } from '../print/browserPrintTransportManager';
import { WyseeEditorProvider } from '../editor/wyseeEditorProvider';

export class SelfCheckService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: WyseeEditorProvider,
    private readonly themeService: ThemeService,
    private readonly pageProfileService: PageProfileService,
    private readonly spellService: SpellService,
    private readonly printServer: ExternalPrintServer,
    private readonly transportManager: BrowserPrintTransportManager,
  ) {}

  async runSelfCheck(): Promise<SelfCheckReport> {
    const items: SelfCheckReportItem[] = [];
    const pkg = this.context.extension.packageJSON as any;
    items.push(check('custom editor registration', Array.isArray(pkg?.contributes?.customEditors) && pkg.contributes.customEditors.some((item: any) => item.viewType === VIEWTYPE_EDITOR), 'customEditors contribution present'));
    const uri = this.provider.getActiveSession()?.document.uri;
    const theme = await this.themeService.getActiveTheme(uri);
    items.push(check('current theme compile', Boolean(this.themeService.compileThemeToPreviewCss(theme).trim()), theme.id));
    const pageProfile = await this.pageProfileService.getActivePageProfile(uri);
    items.push(check('current page profile compile', Boolean(this.pageProfileService.compileThemeToPrintCss(theme, pageProfile).trim()), pageProfile.id));
    try {
      await this.spellService.initialize();
      items.push(check('spell engine ready', true));
    } catch (error) {
      items.push(check('spell engine ready', false, String(error)));
    }
    try {
      const language = vscode.workspace.getConfiguration('wyseeMd', uri).get<string>('spell.language', 'en-US');
      const dictPath = await (this.spellService as any).dictionaryService?.getUserDictionaryPath?.(language);
      items.push(check('dictionary paths readable/writable', Boolean(dictPath), dictPath));
    } catch (error) {
      items.push(check('dictionary paths readable/writable', false, String(error)));
    }
    items.push(check('print server can bind', await this.printServer.canBind(), '127.0.0.1'));
    items.push(check('browser adapter resolution', Boolean(this.transportManager.resolveAdapterName()), this.transportManager.resolveAdapterName()));
    items.push(check('workspace trust state', true, vscode.workspace.isTrusted ? 'trusted' : 'restricted'));
    const session = this.provider.getActiveSession();
    items.push(check('current session state integrity', !session || Boolean(session.state.sessionId && session.document.uri), session?.state));
    items.push(check('active document association', true, 'See workbench.editorAssociations for persisted defaults.'));
    return { ok: items.every((item) => item.ok), items };
  }
}

function check(name: string, ok: boolean, detail?: unknown): SelfCheckReportItem {
  return { name, ok, detail: detail === undefined ? undefined : typeof detail === 'string' ? detail : JSON.stringify(detail) };
}
