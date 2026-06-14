export type GisExportScope = 'combined' | 'per-node';

export type GisCoverageBounds = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type GisCoverageResult = {
  visible?: boolean;
  signalGrid?: ArrayLike<number> | null;
  gridRes?: number;
  bounds?: GisCoverageBounds | null;
  effectiveSens?: number;
  rep?: { id?: number | string; name?: string } | null;
  label?: string;
};

export type GisFeatureProperties = Record<string, string | number | boolean | null>;
export type GisRing = Array<[number, number]>;
export type GisPolygonFeature = {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: [GisRing];
  };
  properties: GisFeatureProperties;
};

export type GisFeatureCollection = {
  type: 'FeatureCollection';
  properties: Record<string, unknown>;
  features: GisPolygonFeature[];
};

export type GisExportResult = {
  fc: GisFeatureCollection;
  downsampled: boolean;
  stride: number;
};

export type GisExportOptions = {
  scope: GisExportScope;
  maxSide?: number;
  generatedAt?: string;
  networkStats?: Record<string, unknown>;
};

type ValidLayer = {
  result: GisCoverageResult;
  index: number;
  label: string;
  sourceId: string | number | null;
  signalGrid: ArrayLike<number>;
  gridRes: number;
  bounds: GisCoverageBounds;
  effectiveSens: number;
};

type Sample = {
  layer: ValidLayer;
  rssi: number;
  margin: number;
};

const DEFAULT_POLYGON_MAX_SIDE = 220;

export function buildCoveragePolygonGeoJson(
  results: GisCoverageResult[] | null | undefined,
  options: GisExportOptions
): GisExportResult {
  const layers = validCoverageLayers(results);
  const maxSide = Math.max(1, Math.floor(options.maxSide ?? DEFAULT_POLYGON_MAX_SIDE));
  const maxGridRes = Math.max(1, ...layers.map(layer => layer.gridRes));
  const stride = Math.max(1, Math.ceil(maxGridRes / maxSide));
  const features = options.scope === 'combined'
    ? combinedCoverageFeatures(layers, stride)
    : perNodeCoverageFeatures(layers, stride);

  return {
    fc: {
      type: 'FeatureCollection',
      properties: {
        exportType: 'coverage-polygons',
        exportScope: options.scope,
        layerScope: 'visible',
        generatedAt: options.generatedAt ?? new Date().toISOString(),
        sourceLayerCount: layers.length,
        downsampled: stride > 1,
        stride,
        networkStats: options.networkStats ?? {},
      },
      features,
    },
    downsampled: stride > 1,
    stride,
  };
}

export function buildCoverageKml(fc: GisFeatureCollection, title = 'MeshCore Coverage'): string {
  const placemarks = fc.features.map((feature, index) => {
    const name = feature.properties.node || feature.properties.label || `Coverage ${index + 1}`;
    const extendedData = Object.entries(feature.properties)
      .map(([key, value]) => `        <Data name="${xmlEscape(key)}"><value>${xmlEscape(formatKmlValue(value))}</value></Data>`)
      .join('\n');
    const coordinates = feature.geometry.coordinates[0]
      .map(([lon, lat]) => `${roundCoord(lon)},${roundCoord(lat)},0`)
      .join(' ');
    return `    <Placemark>
      <name>${xmlEscape(String(name))}</name>
      <styleUrl>#coverage</styleUrl>
      <ExtendedData>
${extendedData}
      </ExtendedData>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinates}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(title)}</name>
    <Style id="coverage">
      <LineStyle><color>cc2f80ed</color><width>1</width></LineStyle>
      <PolyStyle><color>662f80ed</color></PolyStyle>
    </Style>
${placemarks}
  </Document>
</kml>`;
}

export function buildKmz(kml: string, fileName = 'doc.kml'): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(fileName);
  const data = encoder.encode(kml);
  const crc = crc32(data);
  const localHeaderSize = 30 + nameBytes.length;
  const centralHeaderSize = 46 + nameBytes.length;
  const totalSize = localHeaderSize + data.length + centralHeaderSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  let offset = 0;

  writeUint32(view, offset, 0x04034b50); offset += 4;
  writeUint16(view, offset, 20); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint32(view, offset, crc); offset += 4;
  writeUint32(view, offset, data.length); offset += 4;
  writeUint32(view, offset, data.length); offset += 4;
  writeUint16(view, offset, nameBytes.length); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  out.set(nameBytes, offset); offset += nameBytes.length;
  out.set(data, offset); offset += data.length;

  const centralOffset = offset;
  writeUint32(view, offset, 0x02014b50); offset += 4;
  writeUint16(view, offset, 20); offset += 2;
  writeUint16(view, offset, 20); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint32(view, offset, crc); offset += 4;
  writeUint32(view, offset, data.length); offset += 4;
  writeUint32(view, offset, data.length); offset += 4;
  writeUint16(view, offset, nameBytes.length); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint32(view, offset, 0); offset += 4;
  writeUint32(view, offset, 0); offset += 4;
  out.set(nameBytes, offset); offset += nameBytes.length;

  const centralSize = offset - centralOffset;
  writeUint32(view, offset, 0x06054b50); offset += 4;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 0); offset += 2;
  writeUint16(view, offset, 1); offset += 2;
  writeUint16(view, offset, 1); offset += 2;
  writeUint32(view, offset, centralSize); offset += 4;
  writeUint32(view, offset, centralOffset); offset += 4;
  writeUint16(view, offset, 0);

  return out;
}

function validCoverageLayers(results: GisCoverageResult[] | null | undefined): ValidLayer[] {
  const all = Array.isArray(results) ? results : [];
  return all
    .map((result, index): ValidLayer | null => {
      const gridRes = Number(result?.gridRes);
      const effectiveSens = Number(result?.effectiveSens);
      const signalGrid = result?.signalGrid;
      const bounds = result?.bounds;
      if (result?.visible === false) return null;
      if (!signalGrid || !Number.isInteger(gridRes) || gridRes <= 0) return null;
      if (!bounds || !validBounds(bounds)) return null;
      if (!Number.isFinite(effectiveSens)) return null;
      return {
        result,
        index,
        label: result.rep?.name || result.label || `Layer ${index + 1}`,
        sourceId: result.rep?.id ?? null,
        signalGrid,
        gridRes,
        bounds,
        effectiveSens,
      };
    })
    .filter((layer): layer is ValidLayer => layer !== null);
}

function perNodeCoverageFeatures(layers: ValidLayer[], stride: number): GisPolygonFeature[] {
  const features: GisPolygonFeature[] = [];
  for (const layer of layers) {
    for (let r = 0; r < layer.gridRes; r += stride) {
      for (let c = 0; c < layer.gridRes; c += stride) {
        const rssi = Number(layer.signalGrid[r * layer.gridRes + c]);
        if (!Number.isFinite(rssi) || rssi < layer.effectiveSens) continue;
        const margin = rssi - layer.effectiveSens;
        features.push(featureForCell(layer.bounds, layer.gridRes, r, c, stride, {
          export_scope: 'per-node',
          node: layer.label,
          source_id: layer.sourceId === null ? null : String(layer.sourceId),
          source_index: layer.index,
          rssi_dbm: roundOne(rssi),
          margin_db: roundOne(margin),
          grid_row: r,
          grid_col: c,
          cell_stride: stride,
        }));
      }
    }
  }
  return features;
}

function combinedCoverageFeatures(layers: ValidLayer[], stride: number): GisPolygonFeature[] {
  const reference = layers.reduce<ValidLayer | null>((best, layer) => {
    if (!best || layer.gridRes > best.gridRes) return layer;
    return best;
  }, null);
  if (!reference) return [];

  const features: GisPolygonFeature[] = [];
  for (let r = 0; r < reference.gridRes; r += stride) {
    for (let c = 0; c < reference.gridRes; c += stride) {
      const center = cellCenter(reference.bounds, reference.gridRes, r, c, stride);
      const samples = layers
        .map(layer => sampleLayerAt(layer, center.lat, center.lon))
        .filter((sample): sample is Sample => sample !== null && sample.margin >= 0);
      if (!samples.length) continue;
      samples.sort((a, b) => b.margin - a.margin);
      const best = samples[0];
      features.push(featureForCell(reference.bounds, reference.gridRes, r, c, stride, {
        export_scope: 'combined',
        node: best.layer.label,
        source_id: best.layer.sourceId === null ? null : String(best.layer.sourceId),
        source_index: best.layer.index,
        coverage_count: samples.length,
        rssi_dbm: roundOne(best.rssi),
        margin_db: roundOne(best.margin),
        grid_row: r,
        grid_col: c,
        cell_stride: stride,
      }));
    }
  }
  return features;
}

function sampleLayerAt(layer: ValidLayer, lat: number, lon: number): Sample | null {
  const { bounds, gridRes } = layer;
  if (lat < bounds.latMin || lat > bounds.latMax || lon < bounds.lonMin || lon > bounds.lonMax) return null;
  const rowFloat = (bounds.latMax - lat) / (bounds.latMax - bounds.latMin) * gridRes;
  const colFloat = (lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin) * gridRes;
  const r = clampIndex(Math.floor(rowFloat), gridRes);
  const c = clampIndex(Math.floor(colFloat), gridRes);
  const rssi = Number(layer.signalGrid[r * gridRes + c]);
  if (!Number.isFinite(rssi)) return null;
  return {
    layer,
    rssi,
    margin: rssi - layer.effectiveSens,
  };
}

function featureForCell(
  bounds: GisCoverageBounds,
  gridRes: number,
  r: number,
  c: number,
  stride: number,
  properties: GisFeatureProperties
): GisPolygonFeature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [cellRing(bounds, gridRes, r, c, stride)],
    },
    properties,
  };
}

function cellRing(bounds: GisCoverageBounds, gridRes: number, r: number, c: number, stride: number): GisRing {
  const rowEnd = Math.min(gridRes, r + stride);
  const colEnd = Math.min(gridRes, c + stride);
  const latSpan = bounds.latMax - bounds.latMin;
  const lonSpan = bounds.lonMax - bounds.lonMin;
  const north = bounds.latMax - (r / gridRes) * latSpan;
  const south = bounds.latMax - (rowEnd / gridRes) * latSpan;
  const west = bounds.lonMin + (c / gridRes) * lonSpan;
  const east = bounds.lonMin + (colEnd / gridRes) * lonSpan;
  return [
    [roundCoord(west), roundCoord(south)],
    [roundCoord(east), roundCoord(south)],
    [roundCoord(east), roundCoord(north)],
    [roundCoord(west), roundCoord(north)],
    [roundCoord(west), roundCoord(south)],
  ];
}

function cellCenter(bounds: GisCoverageBounds, gridRes: number, r: number, c: number, stride: number): { lat: number; lon: number } {
  const rowEnd = Math.min(gridRes, r + stride);
  const colEnd = Math.min(gridRes, c + stride);
  const rowMid = (r + rowEnd) / 2;
  const colMid = (c + colEnd) / 2;
  return {
    lat: bounds.latMax - (rowMid / gridRes) * (bounds.latMax - bounds.latMin),
    lon: bounds.lonMin + (colMid / gridRes) * (bounds.lonMax - bounds.lonMin),
  };
}

function validBounds(bounds: GisCoverageBounds): boolean {
  return Number.isFinite(bounds.latMin)
    && Number.isFinite(bounds.latMax)
    && Number.isFinite(bounds.lonMin)
    && Number.isFinite(bounds.lonMax)
    && bounds.latMax > bounds.latMin
    && bounds.lonMax > bounds.lonMin;
}

function clampIndex(value: number, gridRes: number): number {
  return Math.min(gridRes - 1, Math.max(0, value));
}

function formatKmlValue(value: string | number | boolean | null): string {
  if (value === null) return '';
  return String(value);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function roundOne(value: number): number {
  return Number(value.toFixed(1));
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

let _crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
  const table = _crcTable ?? buildCrcTable();
  _crcTable = table;
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < table.length; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}
