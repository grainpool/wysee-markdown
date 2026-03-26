const blockedPatterns = [/[@{}]/, /expression\s*\(/i, /javascript:/i];

export function sanitizeStyleDeclarations(input: string): string {
  if (!input) {
    return '';
  }
  const cleanedParts: string[] = [];
  for (const piece of input.split(';')) {
    const trimmed = piece.trim();
    if (!trimmed) {
      continue;
    }
    if (blockedPatterns.some((pattern) => pattern.test(trimmed))) {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const property = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (!/^[a-zA-Z-]+$/.test(property) || !value) {
      continue;
    }
    cleanedParts.push(`${property}: ${value}`);
  }
  return cleanedParts.join('; ');
}
