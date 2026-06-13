import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl, isSameDocument } from '../../src/main/urlGuards.js';

describe('isSafeExternalUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeExternalUrl('http://example.com/')).toBe(true);
    expect(isSafeExternalUrl('https://example.com/path?q=1#h')).toBe(true);
  });

  it('rejects file:// and other unsafe schemes', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeExternalUrl('ftp://example.com/')).toBe(false);
    expect(isSafeExternalUrl('chrome://settings/')).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });
});

describe('isSameDocument', () => {
  it('treats hash-only changes as same-document', () => {
    expect(isSameDocument(
      'file:///c/app/index.html#section',
      'file:///c/app/index.html',
    )).toBe(true);
  });

  it('treats query-string changes as same-document', () => {
    expect(isSameDocument(
      'file:///c/app/index.html?x=1',
      'file:///c/app/index.html',
    )).toBe(true);
  });

  it('treats different pathnames as cross-document', () => {
    expect(isSameDocument(
      'file:///c/app/other.html',
      'file:///c/app/index.html',
    )).toBe(false);
  });

  it('treats different hosts as cross-document', () => {
    expect(isSameDocument(
      'https://evil.example.com/',
      'https://app.example.com/',
    )).toBe(false);
  });

  it('treats different protocols as cross-document', () => {
    expect(isSameDocument(
      'http://example.com/',
      'https://example.com/',
    )).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(isSameDocument('not a url', 'file:///app/index.html')).toBe(false);
    expect(isSameDocument('file:///app/index.html', 'not a url')).toBe(false);
  });
});
