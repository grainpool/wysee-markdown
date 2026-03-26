import sanitizeHtmlLib from 'sanitize-html';
import { TraceService } from '../diagnostics/trace';
import { ERROR_CODES } from '../diagnostics/errorCodes';

const allowedTags = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'strong', 'em',
  'del', 's', 'input', 'span', 'div', 'sup', 'sub', 'section', 'aside', 'dl', 'dt', 'dd'
];

const allowedAttributes: sanitizeHtmlLib.IOptions['allowedAttributes'] = {
  '*': ['class', 'data-*', 'style', 'align', 'hidden', 'aria-*', 'title', 'id'],
  a: ['href', 'target', 'rel', 'name', 'id'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  input: ['type', 'checked', 'disabled'],
  sup: ['id'],
  li: ['id', 'value'],
  ol: ['start', 'type'],
  section: ['class'],
};

export function sanitizeRenderedHtml(html: string, trace: TraceService, uri?: string): string {
  const sanitized = sanitizeHtmlLib(html, {
    allowedTags,
    allowedAttributes,
    allowedSchemes: ['http', 'https', 'data', 'file', 'mailto'],
    allowedSchemesAppliedToAttributes: ['src'],
    allowProtocolRelative: false,
    parser: { lowerCaseAttributeNames: false },
  });
  if (sanitized !== html) {
    trace.warn(`${ERROR_CODES.securitySanitized} Sanitized HTML content`, { uri });
  }
  return sanitized;
}
