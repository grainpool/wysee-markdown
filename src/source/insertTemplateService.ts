import * as vscode from 'vscode';
import { BlockMapEntry, InsertAnchor, InsertTarget } from '../types';
import { buildBlockMap } from '../render/blockMap';
import { offsetsToRange } from './rangeMath';
import { TraceService } from '../diagnostics/trace';

export class InsertTemplateService {
  constructor(private readonly trace: TraceService) {}

  async insertTemplate(target: InsertTarget, templateId: string, anchor: InsertAnchor = 'after', dims?: { cols: number; rows: number }): Promise<void> {
    const document = await vscode.workspace.openTextDocument(target.uri);
    const insertion = templateFor(templateId, dims);
    const edit = new vscode.WorkspaceEdit();
    if (target.selection) {
      // Source editor: insert at cursor
      edit.replace(target.uri, target.selection, insertion);
    } else if (target.blockId) {
      const blocks = buildBlockMap(document);
      const block = blocks.find((item) => item.blockId === target.blockId);
      if (!block) {
        // Block not found — fall through to end-of-document append
        this.appendAtEnd(edit, document, insertion);
      } else {
        const position = anchor === 'before' ? document.positionAt(block.startOffset) : document.positionAt(block.endOffset);
        const prefix = anchor === 'before' ? '' : '\n';
        edit.insert(target.uri, position, `${prefix}${ensureSeparated(insertion)}`);
      }
    } else {
      // No block context — append at end (before footnote defs if any)
      this.appendAtEnd(edit, document, insertion);
    }
    this.trace.debug('Insert template', { templateId, uri: target.uri.toString(), anchor, dims });
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }

  private appendAtEnd(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, insertion: string): void {
    const blocks = buildBlockMap(document);
    // Find last non-footnote-definition block
    const contentBlocks = blocks.filter(b => b.kind !== 'footnoteDefinition');
    if (contentBlocks.length > 0) {
      const lastBlock = contentBlocks[contentBlocks.length - 1];
      const position = document.positionAt(lastBlock.endOffset);
      edit.insert(document.uri, position, `\n${ensureSeparated(insertion)}`);
    } else {
      // Completely empty or only frontmatter
      const text = document.getText();
      const offset = text.length;
      const prefix = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
      edit.insert(document.uri, document.positionAt(offset), `${prefix}${ensureSeparated(insertion)}`);
    }
  }
}

function ensureSeparated(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function templateFor(templateId: string, dims?: { cols: number; rows: number }): string {
  switch (templateId) {
    case 'heading1': return '# Heading\n';
    case 'heading2': return '## Heading\n';
    case 'heading3': return '### Heading\n';
    case 'heading4': return '#### Heading\n';
    case 'heading5': return '##### Heading\n';
    case 'heading6': return '###### Heading\n';
    case 'link': return '[Link text](https://example.com)\n';
    case 'image': return '![Alt](./image.png){width=100%, align=center}\n';
    case 'quote': return '> Quote\n';
    case 'footnote': return 'Text with footnote.[^1]\n\n[^1]: Footnote text.\n';
    case 'codeFence': return '```text\ncode\n```\n';
    case 'hr': return '---\n';
    case 'table2x2': return buildTable(2, 2, false);
    case 'tableAligned': return buildTable(3, 3, true);
    case 'tableCustom': return buildTable(dims?.cols ?? 3, dims?.rows ?? 3, false);
    case 'taskList': return '- [ ] Task\n- [ ] Task\n';
    case 'mermaidFence': return '```mermaid\nflowchart TD\n  A[Start] --> B[Finish]\n```\n';
    default: return `${templateId}\n`;
  }
}

function buildTable(cols: number, rows: number, aligned: boolean): string {
  const headers = Array.from({ length: cols }, (_, i) => ` Col ${i + 1} `);
  const align = Array.from({ length: cols }, (_, i) => (aligned && i === 0 ? ' :--- ' : ' --- '));
  const body = Array.from({ length: Math.max(rows - 1, 1) }, (_, row) => `|${Array.from({ length: cols }, (_, col) => ` R${row + 1}C${col + 1} `).join('|')}|`);
  return [`|${headers.join('|')}|`, `|${align.join('|')}|`, ...body].join('\n') + '\n';
}
