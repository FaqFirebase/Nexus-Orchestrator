import { describe, it, expect } from 'vitest';
import { maskKey, isMaskedKey, restoreMaskedSecret } from '../secretMask.js';

const KEY_A = 'provider-key-aaaa1111';
const KEY_B = 'provider-key-bbbb2222';

describe('maskKey / isMaskedKey', () => {
  it('shows the first and last 4 characters', () => {
    expect(maskKey(KEY_A)).toBe('prov...1111');
  });

  it('hides short keys fully', () => {
    expect(maskKey('short')).toBe('****');
  });

  it('recognises masked values only', () => {
    expect(isMaskedKey(maskKey(KEY_A))).toBe(true);
    expect(isMaskedKey('****')).toBe(true);
    expect(isMaskedKey(KEY_A)).toBe(false);
    expect(isMaskedKey(undefined)).toBe(false);
  });
});

describe('restoreMaskedSecret', () => {
  it('keeps a key when its entry changed URL (no same-URL match)', () => {
    expect(restoreMaskedSecret(maskKey(KEY_A), [], [KEY_A, KEY_B])).toBe(KEY_A);
  });

  it('never gives an entry another entry\'s key after a deletion', () => {
    // Provider A deleted; provider B (now first) sends back its own mask
    expect(restoreMaskedSecret(maskKey(KEY_B), [], [KEY_A, KEY_B])).toBe(KEY_B);
  });

  it('keeps distinct keys for two entries with the same URL', () => {
    expect(restoreMaskedSecret(maskKey(KEY_A), [KEY_B, KEY_A])).toBe(KEY_A);
    expect(restoreMaskedSecret(maskKey(KEY_B), [KEY_B, KEY_A])).toBe(KEY_B);
  });

  it('prefers the preferred candidate for short keys that share the "****" mask', () => {
    expect(restoreMaskedSecret('****', ['mine'], ['other'])).toBe('mine');
  });

  it('returns empty when no stored key matches', () => {
    expect(restoreMaskedSecret('zzzz...9999', [KEY_A], [KEY_B])).toBe('');
  });
});
