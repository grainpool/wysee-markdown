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
