// Masking for secrets sent to the browser, and restoring them when the browser sends the mask back.

const MASKED_SHORT_KEY = '****';
const MASK_SEPARATOR = '...';
const MASK_VISIBLE_CHARS = 4;

/** "sk-abcdef123456" → "sk-a...3456"; keys of 8 chars or less → "****". */
export function maskKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= MASK_VISIBLE_CHARS * 2) return MASKED_SHORT_KEY;
  return `${key.substring(0, MASK_VISIBLE_CHARS)}${MASK_SEPARATOR}${key.substring(key.length - MASK_VISIBLE_CHARS)}`;
}

/** True when a client sent back a value produced by maskKey instead of a real key. */
export function isMaskedKey(value: unknown): value is string {
  return typeof value === 'string' && (value.includes(MASK_SEPARATOR) || value === MASKED_SHORT_KEY);
}

/**
 * Returns the stored secret whose mask equals the masked value the client sent back.
 * Preferred candidates are tried first, so short keys (which all mask to "****") resolve to their own entry.
 */
export function restoreMaskedSecret(
  masked: string,
  preferred: Array<string | undefined>,
  others: Array<string | undefined> = [],
): string {
  return [...preferred, ...others].find(key => !!key && maskKey(key) === masked) || '';
}
