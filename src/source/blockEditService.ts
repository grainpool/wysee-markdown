import * as vscode from 'vscode';
import { ERROR_CODES } from '../diagnostics/errorCodes';
import { TraceService } from '../diagnostics/trace';
import { BlockEditPayload, BlockMapEntry } from '../types';
import { buildBlockMap } from '../render/blockMap';
import { offsetsToRange } from './rangeMath';
import { planBlockReplacement } from './editPlanner';

export class BlockEditService {
  constructor(private readonly trace: TraceService) {}

  async applyBlockEdit(document: vscode.TextDocument, payload: BlockEditPayload): Promise<void> {
    const block = this.resolveBlock(document, payload);
    if (!block) {
      throw new Error(`${ERROR_CODES.versionMismatch}: block no longer matches current document version.`);
    }
    const replacement = planBlockReplacement(block, payload);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, offsetsToRange(document, block.startOffset, block.endOffset), replacement + trailingNewline(document, block));
    this.trace.debug('Applying block edit', { uri: document.uri.toString(), blockId: block.blockId, editKind: payload.editKind });
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }

  resolveBlock(document: vscode.TextDocument, payload: BlockEditPayload): BlockMapEntry | undefined {
    const blocks = buildBlockMap(document);
    const exact = blocks.find((item) => item.blockId === payload.blockId);
    if (exact) {
      return exact;
    }
    return payload.documentVersion === document.version ? undefined : blocks.find((item) => item.blockId === payload.blockId);
  }
}

function trailingNewline(document: vscode.TextDocument, block: BlockMapEntry): string {
  const text = document.getText();
  const end = block.endOffset;
  if (end > block.startOffset && end <= text.length) {
    const ch = text[end - 1];
    if (ch === '\n' || ch === '\r') {
      return '\n';
    }
  }
  return '';
}
