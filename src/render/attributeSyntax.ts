import { escapeHtml } from '../util/strings';

export interface ImageAttributeSyntax {
  alt: string;
  src: string;
  title?: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

const IMAGE_ATTR_REGEX = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\{([^}]*)\}/g;

export function parseImageAttributeSyntax(markdown: string): ImageAttributeSyntax[] {
  // Strip code constructs before scanning for image syntax
  let stripped = markdown;
  stripped = stripped.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
  stripped = stripped.replace(/(`+)(?!\s*$)([\s\S]*?[^`])\1(?!`)/g, '');
  stripped = stripped.replace(/^(?: {4}|\t).+(\n(?: {4}|\t).+)*/gm, '');

  const items: ImageAttributeSyntax[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(IMAGE_ATTR_REGEX.source, IMAGE_ATTR_REGEX.flags);
  while ((match = regex.exec(stripped))) {
    const attrs = parseAttrList(match[4]);
    items.push({
      alt: match[1],
      src: match[2],
      title: match[3],
      width: attrs.width,
      align: normalizeAlign(attrs.align),
    });
  }
  return items;
}

export function applyImageAttributeSyntax(markdown: string): string {
  // Protect all code constructs from image-syntax matching
  const codeMasks: string[] = [];
  function stash(match: string): string {
    codeMasks.push(match);
    return `\x00IMGGUARD${codeMasks.length - 1}\x00`;
  }

  let masked = markdown;
  // 1. Fenced code blocks (``` or ~~~)
  masked = masked.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, stash);
  // 2. Inline code spans (any backtick run length)
  masked = masked.replace(/(`+)(?!\s*$)([\s\S]*?[^`])\1(?!`)/g, stash);
  // 3. Indented code blocks
  masked = masked.replace(/^(?: {4}|\t).+(\n(?: {4}|\t).+)*/gm, stash);

  // Apply image attribute syntax to non-code content
  masked = masked.replace(IMAGE_ATTR_REGEX, (_all, alt, src, title, rawAttrs) => {
    const attrs = parseAttrList(rawAttrs);
    const width = attrs.width ? ` style="${escapeHtml(`max-width:${attrs.width}; width:${attrs.width};`)}"` : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const alignClass = normalizeAlign(attrs.align) ? ` class="wysee-image align-${normalizeAlign(attrs.align)}"` : ' class="wysee-image"';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr}${alignClass}${width} data-wysee-image-attrs="1" />`;
  });

  // Restore code
  return masked.replace(/\x00IMGGUARD(\d+)\x00/g, (_, i) => codeMasks[Number(i)]);
}

export function extractNthImage(markdown: string, occurrenceIndex: number): ImageAttributeSyntax | undefined {
  return parseImageAttributeSyntax(markdown)[occurrenceIndex];
}

export function replaceNthImage(markdown: string, occurrenceIndex: number, next: ImageAttributeSyntax): string {
  let seen = -1;
  return markdown.replace(IMAGE_ATTR_REGEX, (_all, _alt, _src, title) => {
    seen += 1;
    if (seen !== occurrenceIndex) {
      return _all;
    }
    const titlePart = title ? ` \"${title}\"` : '';
    const attrParts: string[] = [];
    if (next.width) {
      attrParts.push(`width=${next.width}`);
    }
    if (next.align) {
      attrParts.push(`align=${next.align}`);
    }
    const attrSuffix = attrParts.length ? `{${attrParts.join(', ')}}` : '';
    return `![${next.alt}](${next.src}${titlePart})${attrSuffix}`;
  });
}

function parseAttrList(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const piece of raw.split(',')) {
    const [key, ...rest] = piece.split('=');
    if (!key || rest.length === 0) {
      continue;
    }
    out[key.trim()] = rest.join('=').trim();
  }
  return out;
}

function normalizeAlign(value?: string): 'left' | 'center' | 'right' | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  return normalized === 'left' || normalized === 'center' || normalized === 'right' ? normalized : undefined;
}
