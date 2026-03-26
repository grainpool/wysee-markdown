import { ImageAttributeSyntax, replaceNthImage } from '../render/attributeSyntax';
import { BlockMapEntry, BlockEditPayload } from '../types';

export function planBlockReplacement(block: BlockMapEntry, payload: BlockEditPayload): string {
  switch (payload.editKind) {
    case 'text':
      return replaceTextualBlock(block, payload.value ?? payload.text ?? '');
    case 'raw':
      return payload.value ?? '';
    case 'link':
      return replaceNthLink(block.raw, payload.occurrenceIndex ?? 0, payload.text ?? '', payload.url ?? '');
    case 'image':
      return replaceNthImage(block.raw, payload.occurrenceIndex ?? 0, {
        alt: payload.alt ?? '',
        src: payload.src ?? '',
        width: payload.width,
        align: normalizeAlign(payload.align),
      } as ImageAttributeSyntax);
    case 'tableCell':
      return replaceTableCell(block.raw, payload.row ?? 0, payload.col ?? 0, payload.value ?? payload.text ?? '');
    default:
      return payload.value ?? '';
  }
}

export function replaceTextualBlock(block: BlockMapEntry, nextText: string): string {
  switch (block.kind) {
    case 'heading': {
      const match = /^(#{1,6})(\s+)(.*)$/.exec(firstLine(block.raw));
      const prefix = match ? `${match[1]}${match[2]}` : '# ';
      return `${prefix}${nextText.trim()}`;
    }
    case 'blockquote': {
      const prefix = (/^(\s*(?:>\s*)+)/.exec(firstLine(block.raw))?.[1]) ?? '> ';
      return nextText.split(/\r?\n/).map((line) => `${prefix}${line}`).join('\n');
    }
    case 'listItem': {
      const first = firstLine(block.raw);
      const prefix = (/^(\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/.exec(first)?.[1]) ?? '- ';
      const lines = nextText.split(/\r?\n/);
      return [
        `${prefix}${lines[0] ?? ''}`,
        ...lines.slice(1).map((line) => line ? `  ${line}` : line),
      ].join('\n');
    }
    case 'codeFence':
    case 'mermaidFence': {
      const lines = block.raw.split(/\r?\n/);
      const open = lines[0] ?? '```';
      const close = lines[lines.length - 1]?.startsWith('```') || lines[lines.length - 1]?.startsWith('~~~') ? lines[lines.length - 1] : open.replace(/\s.*$/, '');
      return `${open}\n${nextText}\n${close}`;
    }
    case 'paragraph':
    default:
      return nextText;
  }
}

export function replaceNthLink(markdown: string, occurrenceIndex: number, nextText: string, nextUrl: string): string {
  const regex = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;
  let seen = -1;
  return markdown.replace(regex, (_all, _text, _url, title) => {
    seen += 1;
    if (seen !== occurrenceIndex) {
      return _all;
    }
    const titlePart = title ? ` \"${title}\"` : '';
    return `[${nextText}](${nextUrl}${titlePart})`;
  });
}

export function replaceTableCell(raw: string, row: number, col: number, nextValue: string): string {
  const lines = raw.split(/\r?\n/);
  const sourceLineIndex = row === 0 ? 0 : row + 1;
  if (sourceLineIndex >= lines.length) {
    return raw;
  }
  const cells = splitTableRow(lines[sourceLineIndex]);
  if (col >= cells.length) {
    return raw;
  }
  cells[col] = ` ${nextValue.trim()} `;
  lines[sourceLineIndex] = `|${cells.join('|')}|`;
  return lines.join('\n');
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|');
}

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0] ?? text;
}

function normalizeAlign(value?: string): 'left' | 'center' | 'right' | undefined {
  if (!value) {
    return undefined;
  }
  const next = value.toLowerCase();
  return next === 'left' || next === 'center' || next === 'right' ? next : undefined;
}
