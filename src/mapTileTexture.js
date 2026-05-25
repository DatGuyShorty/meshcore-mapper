const TILE_SIZE = 256;

export function clampTileZoom(zoom, maxZoom = 19) {
  const z = Math.round(Number.isFinite(zoom) ? zoom : 12);
  return Math.max(0, Math.min(Math.floor(maxZoom ?? 19), z));
}

export function latLonToTilePixel(lat, lon, zoom) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const n = 2 ** zoom;
  const x = n * ((lon + 180) / 360) * TILE_SIZE;
  const latRad = clampedLat * Math.PI / 180;
  const y = n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * TILE_SIZE;
  return { x, y };
}

export function tileTextureLayout(bounds, zoom, maxTextureSize = 1536) {
  const nw = latLonToTilePixel(bounds.latMax, bounds.lonMin, zoom);
  const se = latLonToTilePixel(bounds.latMin, bounds.lonMax, zoom);
  const pixelWidth = Math.max(1, se.x - nw.x);
  const pixelHeight = Math.max(1, se.y - nw.y);
  const scale = Math.min(1, maxTextureSize / Math.max(pixelWidth, pixelHeight));
  return {
    zoom,
    nw,
    se,
    pixelWidth,
    pixelHeight,
    scale,
    width: Math.max(1, Math.round(pixelWidth * scale)),
    height: Math.max(1, Math.round(pixelHeight * scale)),
    tileXMin: Math.floor(nw.x / TILE_SIZE),
    tileXMax: Math.floor((se.x - 1) / TILE_SIZE),
    tileYMin: Math.floor(nw.y / TILE_SIZE),
    tileYMax: Math.floor((se.y - 1) / TILE_SIZE),
  };
}

export async function buildMapTileCanvas({ bounds, zoom, layerInfo, signal = null, maxTextureSize = 1536 }) {
  const z = clampTileZoom(zoom, layerInfo?.options?.maxZoom);
  const layout = tileTextureLayout(bounds, z, maxTextureSize);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create map texture canvas');
  drawTexturePlaceholder(ctx, canvas.width, canvas.height, layerInfo?.name ?? 'Map');

  const tasks = [];
  for (let x = layout.tileXMin; x <= layout.tileXMax; x++) {
    for (let y = layout.tileYMin; y <= layout.tileYMax; y++) {
      tasks.push({ x, y });
    }
  }

  let loaded = 0;
  await _mapWithConcurrency(tasks, 8, async ({ x, y }) => {
    _throwIfAborted(signal);
    const url = tileUrl(layerInfo, z, x, y);
    const img = await loadTileImage(url, signal).catch(() => null);
    if (!img) return;

    const tileLeft = x * TILE_SIZE;
    const tileTop = y * TILE_SIZE;
    const srcLeft = Math.max(layout.nw.x, tileLeft);
    const srcTop = Math.max(layout.nw.y, tileTop);
    const srcRight = Math.min(layout.se.x, tileLeft + TILE_SIZE);
    const srcBottom = Math.min(layout.se.y, tileTop + TILE_SIZE);
    const sw = Math.max(0, srcRight - srcLeft);
    const sh = Math.max(0, srcBottom - srcTop);
    if (sw <= 0 || sh <= 0) return;

    const sx = srcLeft - tileLeft;
    const sy = srcTop - tileTop;
    const dx = (srcLeft - layout.nw.x) * layout.scale;
    const dy = (srcTop - layout.nw.y) * layout.scale;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw * layout.scale, sh * layout.scale);
    loaded++;
  });

  return { canvas, loaded, total: tasks.length, layout };
}

export function drawTexturePlaceholder(ctx, width, height, label = 'Map') {
  const grd = ctx.createLinearGradient(0, 0, width, height);
  grd.addColorStop(0, '#e8e1d5');
  grd.addColorStop(0.5, '#cfd8bf');
  grd.addColorStop(1, '#9fb4b8');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(70, 90, 110, 0.24)';
  ctx.lineWidth = Math.max(1, width / 360);
  for (let i = -height; i < width; i += Math.max(32, width / 10)) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(20, 28, 36, 0.62)';
  ctx.font = `${Math.max(12, Math.round(width / 38))}px sans-serif`;
  ctx.fillText(label, 12, Math.max(24, height - 16));
}

export function tileUrl(layerInfo, zoom, x, y) {
  const url = layerInfo?.url || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const options = layerInfo?.options ?? {};
  const n = 2 ** zoom;
  const wrappedX = ((x % n) + n) % n;
  const tileY = options.tms ? n - 1 - y : y;
  const subdomains = options.subdomains ?? 'abc';
  const list = Array.isArray(subdomains) ? subdomains : String(subdomains).split('');
  const s = list.length ? list[Math.abs(wrappedX + tileY) % list.length] : '';
  return url
    .replace('{s}', s)
    .replace('{z}', String(zoom))
    .replace('{x}', String(wrappedX))
    .replace('{y}', String(tileY))
    .replace('{r}', '');
}

export function loadTileImage(url, signal = null) {
  _throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      img.src = '';
      reject(_abortError());
    };
    img.onload = () => {
      cleanup();
      resolve(img);
    };
    img.onerror = () => {
      cleanup();
      reject(new Error(`Tile image failed: ${url}`));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    img.src = url;
  });
}

async function _mapWithConcurrency(items, limit, mapper) {
  let next = 0;
  const count = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: count }, async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      await mapper(items[idx], idx);
    }
  }));
}

function _throwIfAborted(signal) {
  if (signal?.aborted) throw _abortError();
}

function _abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
