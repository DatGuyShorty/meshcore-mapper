// URL safety helpers shared by the Electron main process. Extracted so they
// can be unit tested in pure Node without spinning up Electron / BrowserWindow.

/**
 * True for `http:` / `https:` only. Anything else (including `file:`,
 * `javascript:`, `data:`, `chrome:`) is unsafe to hand to `shell.openExternal`.
 */
export function isSafeExternalUrl(url: unknown): boolean {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * True if `targetUrl` is the same document as `currentUrl` (only fragment
 * or query-string differs). Used to allow in-page hash navigation while
 * blocking cross-document navigation.
 */
export function isSameDocument(targetUrl: string, currentUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    const current = new URL(currentUrl);
    return target.protocol === current.protocol
      && target.host === current.host
      && target.pathname === current.pathname;
  } catch {
    return false;
  }
}
