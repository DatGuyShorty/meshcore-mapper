export type SafeWsRow = {
  name: string;
  lat: number;
  lon: number;
  short: string | null;
  lastSeen: string | null;
  wsKey: string | null;
};

export function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function validLatLon(lat: unknown, lon: unknown): boolean {
  const la = Number(lat);
  const lo = Number(lon);
  return Number.isFinite(la)
    && Number.isFinite(lo)
    && la >= -90
    && la <= 90
    && lo >= -180
    && lo <= 180;
}

export function boundedInteger(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function safeSource(source: unknown): string | null {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  return /^[a-z0-9:_-]{1,48}$/i.test(trimmed) ? trimmed : null;
}

export function validBlobPayload(data: unknown): Uint8Array | ArrayBuffer | ArrayBufferView | unknown[] | null {
  if (!data) return null;
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) return data;
  if (Array.isArray(data) && data.length <= 8 * 1024 * 1024) return data;
  return null;
}

export function safeWsRow(row: any): SafeWsRow | null {
  const lat = Number(row?.lat);
  const lon = Number(row?.lon);
  if (!validLatLon(lat, lon)) return null;
  return {
    name: String(row?.name ?? 'Unknown').slice(0, 120),
    lat,
    lon,
    short: row?.short === undefined || row?.short === null ? null : String(row.short).slice(0, 80),
    lastSeen: row?.lastSeen === undefined || row?.lastSeen === null ? null : String(row.lastSeen).slice(0, 80),
    wsKey: row?.wsKey === undefined || row?.wsKey === null ? null : String(row.wsKey).slice(0, 160),
  };
}
