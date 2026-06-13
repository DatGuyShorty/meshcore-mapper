import { normalizeLon } from './osmGeometry.js';

type Bbox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type LayerInfo = {
  url?: string;
  name?: string;
  options?: {
    maxZoom?: number;
    tms?: boolean;
    subdomains?: string | string[];
  };
};

export type TilePixel = {
  x: number;
  y: number;
};

export type TextureLayout = {
  zoom: number;
  nw: TilePixel;
  se: TilePixel;
  pixelWidth: number;
  pixelHeight: number;
  scale: number;
  width: number;
  height: number;
  tileXMin: number;
  tileXMax: number;
  tileYMin: number;
  tileYMax: number;
};

export type SelectedTextureLayout = {
  zoom: number;
  layout: TextureLayout;
  tileCount: number;
  downsampled: boolean;
};

export type MapTileCanvasResult = {
  canvas: HTMLCanvasElement;
  loaded: number;
  total: number;
  layout: TextureLayout;
  sourceZoom: number;
  downsampled: boolean;
};

const TILE_SIZE = 256;
const MAX_TEXTURE_TILE_REQUESTS = 256;
const MIN_TEXTURE_SOURCE_SCALE = 0.5;

export function clampTileZoom(zoom: unknown, maxZoom = 19): number {
  const z = Math.round(typeof zoom === 'number' && Number.isFinite(zoom) ? zoom : 12);
  return Math.max(0, Math.min(Math.floor(maxZoom ?? 19), z));
}

export function latLonToTilePixel(lat: number, lon: number, zoom: number): TilePixel {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const wrappedLon = normalizeLon(lon) ?? 0;
  const n = 2 ** zoom;
  const x = n * ((wrappedLon + 180) / 360) * TILE_SIZE;
  const latRad = clampedLat * Math.PI / 180;
  const y = n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * TILE_SIZE;
  return { x, y };
}

export function tileTextureLayout(bounds: Bbox, zoom: number, maxTextureSize = 1536): TextureLayout {
  const nw = latLonToTilePixel(bounds.latMax, bounds.lonMin, zoom);
  const rawSe = latLonToTilePixel(bounds.latMin, bounds.lonMax, zoom);
  const worldPx = (2 ** zoom) * TILE_SIZE;
  const se = {
    ...rawSe,
    x: rawSe.x <= nw.x ? rawSe.x + worldPx : rawSe.x,
  };
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

export function selectTextureLayout(
  bounds: Bbox,
  zoom: number,
  maxZoom = 19,
  maxTextureSize = 1536,
): SelectedTextureLayout {
  let z = clampTileZoom(zoom, maxZoom);
  let layout = tileTextureLayout(bounds, z, maxTextureSize);
  while (z > 0 && (_layoutTileCount(layout) > MAX_TEXTURE_TILE_REQUESTS || layout.scale < MIN_TEXTURE_SOURCE_SCALE)) {
    z--;
    layout = tileTextureLayout(bounds, z, maxTextureSize);
  }
  return {
    zoom: z,
    layout,
    tileCount: _layoutTileCount(layout),
    downsampled: layout.scale < 1,
  };
}

export async function buildMapTileCanvas({
  bounds,
  zoom,
  layerInfo,
  signal = null,
  maxTextureSize = 1536,
}: {
  bounds: Bbox;
  zoom: number;
  layerInfo: LayerInfo;
  signal?: AbortSignal | null;
  maxTextureSize?: number;
}): Promise<MapTileCanvasResult> {
  const selected = selectTextureLayout(bounds, zoom, layerInfo?.options?.maxZoom, maxTextureSize);
  const z = selected.zoom;
  const layout = selected.layout;
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create map texture canvas');
  drawTexturePlaceholder(ctx, canvas.width, canvas.height, layerInfo?.name ?? 'Map');

  const tasks: Array<{ x: number; y: number }> = [];
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

  return {
    canvas,
    loaded,
    total: tasks.length,
    layout,
    sourceZoom: z,
    downsampled: selected.downsampled,
  };
}

export function drawTexturePlaceholder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  label = 'Map',
): void {
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

export function tileUrl(layerInfo: LayerInfo | null | undefined, zoom: number, x: number, y: number): string {
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

export function loadTileImage(url: string, signal: AbortSignal | null = null): Promise<HTMLImageElement> {
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

async function _mapWithConcurrency<T>(
  items: T[],
  limit: number,
  mapper: (item: T, idx: number) => Promise<void>,
): Promise<void> {
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

function _layoutTileCount(layout: Pick<TextureLayout, 'tileXMin' | 'tileXMax' | 'tileYMin' | 'tileYMax'>): number {
  return Math.max(0, layout.tileXMax - layout.tileXMin + 1)
    * Math.max(0, layout.tileYMax - layout.tileYMin + 1);
}

function _throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw _abortError();
}

function _abortError(): Error & { cancelled?: boolean } {
  const err = new Error('Cancelled') as Error & { cancelled?: boolean };
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
