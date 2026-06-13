import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type PayloadHandler = (payload: unknown) => void;
type WrappedPayloadHandler = (_event: IpcRendererEvent, payload: unknown) => void;

const cudaCoverageProgressHandlers = new WeakMap<PayloadHandler, WrappedPayloadHandler>();
const cudaOptimizerProgressHandlers = new WeakMap<PayloadHandler, WrappedPayloadHandler>();

function onPayloadOnly(
  channel: string,
  handler: unknown,
  handlers: WeakMap<PayloadHandler, WrappedPayloadHandler>
): void {
  if (typeof handler !== 'function') return;
  const typedHandler = handler as PayloadHandler;
  const wrapped: WrappedPayloadHandler = (_event, payload) => typedHandler(payload);
  handlers.set(typedHandler, wrapped);
  ipcRenderer.on(channel, wrapped);
}

function offPayloadOnly(
  channel: string,
  handler: unknown,
  handlers: WeakMap<PayloadHandler, WrappedPayloadHandler>
): void {
  if (typeof handler !== 'function') return;
  const typedHandler = handler as PayloadHandler;
  const wrapped = handlers.get(typedHandler);
  if (!wrapped) return;
  ipcRenderer.off(channel, wrapped);
  handlers.delete(typedHandler);
}

const api: ElectronAPI = {
  saveFile:    (jsonStr) => ipcRenderer.invoke('save-file', jsonStr),
  exportFile:  (payload) => ipcRenderer.invoke('export-file', payload),
  openFile:    ()        => ipcRenderer.invoke('open-file'),
  getPresets:  ()        => ipcRenderer.invoke('get-presets'),
  // SQLite cache
  cacheElevationsLookupBbox: (bbox)    => ipcRenderer.invoke('cache-elevations-lookup-bbox', bbox),
  cacheElevationsLookupMany: (points)  => ipcRenderer.invoke('cache-elevations-lookup-many', points),
  cacheElevationsStore:      (entries) => ipcRenderer.invoke('cache-elevations-store', entries),
  cacheDemTileGet:           (tileKey) => ipcRenderer.invoke('cache-dem-tile-get', tileKey),
  cacheDemTileStore:         (tile)    => ipcRenderer.invoke('cache-dem-tile-store', tile),
  cacheFoliageLookup:        (key)     => ipcRenderer.invoke('cache-foliage-lookup', key),
  cacheFoliageStore:         (key, data) => ipcRenderer.invoke('cache-foliage-store', key, data),
  cacheBuildingsLookup:      (key)     => ipcRenderer.invoke('cache-buildings-lookup', key),
  cacheBuildingsStore:       (key, data) => ipcRenderer.invoke('cache-buildings-store', key, data),
  cacheGetStats:         ()        => ipcRenderer.invoke('cache-get-stats'),
  cachePurgeElevations:  ()        => ipcRenderer.invoke('cache-purge-elevations'),
  cachePurgeFoliage:     ()        => ipcRenderer.invoke('cache-purge-foliage'),
  cachePurgeBuildings:   ()        => ipcRenderer.invoke('cache-purge-buildings'),
  cacheVacuum:           ()        => ipcRenderer.invoke('cache-vacuum'),
  cachePurgeDemTiles:    ()        => ipcRenderer.invoke('cache-purge-dem-tiles'),
  cudaCoverageProbe:     ()        => ipcRenderer.invoke('cuda-coverage-probe'),
  cudaCoverageCompute:   (payload) => ipcRenderer.invoke('cuda-coverage-compute', payload),
  cudaCoverageCancel:    ()        => ipcRenderer.invoke('cuda-coverage-cancel'),
  cudaOptimizerCompute:  (payload) => ipcRenderer.invoke('cuda-optimizer-compute', payload),
  cudaOptimizerCancel:   ()        => ipcRenderer.invoke('cuda-optimizer-cancel'),
  onCudaCoverageProgress: (handler) => {
    onPayloadOnly('cuda-coverage-progress', handler, cudaCoverageProgressHandlers);
  },
  offCudaCoverageProgress: (handler) => {
    offPayloadOnly('cuda-coverage-progress', handler, cudaCoverageProgressHandlers);
  },
  onCudaOptimizerProgress: (handler) => {
    onPayloadOnly('cuda-optimizer-progress', handler, cudaOptimizerProgressHandlers);
  },
  offCudaOptimizerProgress: (handler) => {
    offPayloadOnly('cuda-optimizer-progress', handler, cudaOptimizerProgressHandlers);
  },
  saveScreenshot:        ()        => ipcRenderer.invoke('save-screenshot'),
  wsRepeatersLoad:  ()     => ipcRenderer.invoke('ws-repeaters-load'),
  wsRepeatersSave:  (rows) => ipcRenderer.invoke('ws-repeaters-save', rows),
  wsRepeatersClear: ()     => ipcRenderer.invoke('ws-repeaters-clear'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
