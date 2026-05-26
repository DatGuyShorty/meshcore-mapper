// URL safety helpers shared by the Electron main process. Extracted so they
// can be unit tested in pure Node without spinning up Electron / BrowserWindow.

function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSameDocument(targetUrl, currentUrl) {
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

module.exports = { isSafeExternalUrl, isSameDocument };
