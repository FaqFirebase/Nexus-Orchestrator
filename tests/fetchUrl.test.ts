import { describe, it, expect } from 'vitest';
import {
  stripHtmlToText,
  truncateText,
  validateFetchUrl,
  FETCH_URL_MAX_BYTES,
  FETCH_URL_TRUNCATION_MARKER,
} from '../fetchUrl.js';

describe('stripHtmlToText', () => {
  it('extracts the title from a basic page', () => {
    const html = '<html><head><title>Hello World</title></head><body>Body</body></html>';
    expect(stripHtmlToText(html).title).toBe('Hello World');
  });

  it('returns empty title when none present', () => {
    expect(stripHtmlToText('<p>no title</p>').title).toBe('');
  });

  it('removes script tags entirely', () => {
    const { text } = stripHtmlToText('<p>before</p><script>alert("x")</script><p>after</p>');
    expect(text).not.toContain('alert');
    expect(text).toContain('before');
    expect(text).toContain('after');
  });

  it('removes style tags entirely', () => {
    const { text } = stripHtmlToText('<style>body{color:red}</style><p>hi</p>');
    expect(text).not.toContain('color:red');
    expect(text).toContain('hi');
  });

  it('removes HTML comments', () => {
    const { text } = stripHtmlToText('<!-- secret --><p>visible</p>');
    expect(text).not.toContain('secret');
    expect(text).toContain('visible');
  });

  it('decodes named entities', () => {
    const { text } = stripHtmlToText('<p>Tom &amp; Jerry &lt;3 &nbsp;forever</p>');
    expect(text).toContain('Tom & Jerry <3');
  });

  it('decodes numeric and hex entities', () => {
    const { text } = stripHtmlToText('<p>&#65;&#x42;</p>');
    expect(text).toBe('AB');
  });

  it('inserts newlines for block-level tags', () => {
    const { text } = stripHtmlToText('<p>one</p><p>two</p>');
    expect(text).toMatch(/one\s*\n+\s*two/);
  });

  it('collapses excessive whitespace', () => {
    const { text } = stripHtmlToText('<p>a    b\n\n\n\nc</p>');
    expect(text).not.toMatch(/ {2,}/);
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('handles head-block scripts that contain html-like strings', () => {
    const html = '<head><script>const s = "<div>fake</div>";</script></head><body><p>real</p></body>';
    const { text } = stripHtmlToText(html);
    expect(text).not.toContain('fake');
    expect(text).toContain('real');
  });
});

describe('truncateText', () => {
  it('returns text unchanged when under cap', () => {
    const result = truncateText('short', 1000);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe('short');
  });

  it('truncates and appends marker when over cap', () => {
    const long = 'x'.repeat(FETCH_URL_MAX_BYTES + 1000);
    const result = truncateText(long, FETCH_URL_MAX_BYTES);
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith(FETCH_URL_TRUNCATION_MARKER)).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(
      FETCH_URL_MAX_BYTES + Buffer.byteLength(FETCH_URL_TRUNCATION_MARKER, 'utf8'),
    );
  });

  it('handles multi-byte utf8 characters when truncating', () => {
    // Each emoji is 4 utf-8 bytes — make sure byte-aware truncation does not over-cut
    const emoji = '😀'.repeat(200);
    const cap = 100; // bytes
    const result = truncateText(emoji, cap);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(
      cap + Buffer.byteLength(FETCH_URL_TRUNCATION_MARKER, 'utf8'),
    );
  });
});

describe('validateFetchUrl', () => {
  it('accepts a normal http URL', () => {
    expect(validateFetchUrl('http://example.com').valid).toBe(true);
  });

  it('accepts a normal https URL', () => {
    expect(validateFetchUrl('https://example.com/path?q=1').valid).toBe(true);
  });

  it('accepts RFC-1918 LAN addresses (intentional)', () => {
    expect(validateFetchUrl('http://192.168.1.1/docs').valid).toBe(true);
    expect(validateFetchUrl('http://10.0.0.5').valid).toBe(true);
  });

  it('rejects empty input', () => {
    expect(validateFetchUrl('').valid).toBe(false);
    expect(validateFetchUrl('   ').valid).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(validateFetchUrl('file:///etc/passwd').valid).toBe(false);
    expect(validateFetchUrl('ftp://example.com').valid).toBe(false);
    expect(validateFetchUrl('javascript:alert(1)').valid).toBe(false);
  });

  it('rejects cloud metadata endpoints', () => {
    expect(validateFetchUrl('http://169.254.169.254/latest/meta-data/').valid).toBe(false);
    expect(validateFetchUrl('http://metadata.google.internal/').valid).toBe(false);
    expect(validateFetchUrl('http://metadata.internal/').valid).toBe(false);
    expect(validateFetchUrl('http://kubernetes.default.svc/api').valid).toBe(false);
  });

  it('rejects IPv6 loopback', () => {
    expect(validateFetchUrl('http://[::1]/').valid).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(validateFetchUrl('not-a-url').valid).toBe(false);
  });
});
