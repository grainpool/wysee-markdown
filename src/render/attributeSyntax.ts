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
  const items: ImageAttributeSyntax[] = [];
  let match: RegExpExecArray | null;
  while ((match = IMAGE_ATTR_REGEX.exec(markdown))) {
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
  // Mask inline code spans to prevent matching image syntax inside backticks
  const codeMasks: string[] = [];
  let masked = markdown.replace(/`[^`]+`/g, (match) => {
    codeMasks.push(match);
    return `\x00CODE${codeMasks.length - 1}\x00`;
  });
  // Apply image attribute syntax to non-code content
  masked = masked.replace(IMAGE_ATTR_REGEX, (_all, alt, src, title, rawAttrs) => {
    const attrs = parseAttrList(rawAttrs);
    const width = attrs.width ? ` style="${escapeHtml(`max-width:${attrs.width}; width:${attrs.width};`)}"` : '';
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    const alignClass = normalizeAlign(attrs.align) ? ` class="wysee-image align-${normalizeAlign(attrs.align)}"` : ' class="wysee-image"';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr}${alignClass}${width} data-wysee-image-attrs="1" />`;
  });
  // Restore code spans
  return masked.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeMasks[Number(i)]);
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
