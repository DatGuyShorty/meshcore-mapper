// Ambient declarations for globals injected by `preload.ts` (contextBridge).
// Phase 0a of REWRITE.md uses TypeScript as a static checker over plain JS,
// so this file describes the shape of those injected globals for `tsc`.

declare global {
  /**
   * Leaflet is loaded as a global via `<script src="vendor/leaflet.js">`.
   * Typed coarsely as `any` — we don't depend on @types/leaflet to avoid
   * pulling in third-party types this early in the migration.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const L: any;

  /** Coarse shape of the IPC bridge installed by `preload.ts`. */
  interface ElectronAPI {
    saveFile(jsonStr: string): Promise<void>;
    exportFile(payload: { content: string; defaultName?: string; filterName?: string; extensions?: string[] }): Promise<boolean>;
    exportBinaryFile(payload: { data: Uint8Array | number[] | ArrayBuffer; defaultName?: string; filterName?: string; extensions?: string[] }): Promise<boolean>;
    exportPdfFile(payload: { content: string; defaultName?: string }): Promise<boolean>;
    openFile(): Promise<string | null>;
    getPresets(): Promise<unknown>;

    // SQLite cache — elevations
    cacheElevationsLookupBbox(bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number; }): Promise<Array<{ lat: number; lon: number; elev: number; }>>;
    cacheElevationsLookupMany(points: Array<{ lat: number; lon: number; }>): Promise<Array<{ lat: number; lon: number; elev: number; }>>;
    cacheElevationsStore(entries: Array<{ lat: number; lon: number; elev: number; }>): Promise<void>;

    // SQLite cache — DEM tiles
    cacheDemTileGet(tile: { source: string; z: number; x: number; y: number; }): Promise<Uint8Array | number[] | ArrayBuffer | null>;
    cacheDemTileStore(tile: { source: string; z: number; x: number; y: number; data: Uint8Array | number[] | ArrayBuffer; }): Promise<void>;

    // SQLite cache — foliage + buildings
    cacheFoliageLookup(key: string): Promise<any>;
    cacheFoliageStore(key: string, data: any): Promise<void>;
    cacheBuildingsLookup(key: string): Promise<any>;
    cacheBuildingsStore(key: string, data: any): Promise<void>;

    cacheGetStats(): Promise<{ elevations: number; demTiles: number; foliage: number; buildings: number; sizeKb: number; }>;
    cachePurgeElevations(): Promise<void>;
    cachePurgeFoliage(): Promise<void>;
    cachePurgeBuildings(): Promise<void>;
    cachePurgeDemTiles(): Promise<void>;
    cacheVacuum(): Promise<void>;

    // Python CUDA helper
    cudaCoverageProbe(): Promise<{ available: boolean; reason?: string; }>;
    cudaCoverageCompute(payload: any): Promise<any>;
    cudaCoverageCancel(): Promise<void>;
    cudaOptimizerCompute(payload: any): Promise<any>;
    cudaOptimizerCancel(): Promise<void>;
    onCudaCoverageProgress(handler: (msg: any) => void): void;
    offCudaCoverageProgress(handler: (msg: any) => void): void;
    onCudaOptimizerProgress(handler: (msg: any) => void): void;
    offCudaOptimizerProgress(handler: (msg: any) => void): void;

    // Screenshots + WS-repeater persistence
    saveScreenshot(): Promise<void>;
    captureScreenshotDataUrl(): Promise<string>;
    wsRepeatersLoad(): Promise<any[]>;
    wsRepeatersSave(rows: any[]): Promise<void>;
    wsRepeatersClear(): Promise<void>;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
