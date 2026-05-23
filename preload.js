const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile:    (jsonStr) => ipcRenderer.invoke('save-file', jsonStr),
  openFile:    ()        => ipcRenderer.invoke('open-file'),
  getPresets:  ()        => ipcRenderer.invoke('get-presets'),
  // SQLite cache
  cacheElevationsLookupBbox: (bbox)    => ipcRenderer.invoke('cache-elevations-lookup-bbox', bbox),
  cacheElevationsLookupMany: (points)  => ipcRenderer.invoke('cache-elevations-lookup-many', points),
  cacheElevationsStore:      (entries) => ipcRenderer.invoke('cache-elevations-store', entries),
  cacheFoliageLookup:        (key)     => ipcRenderer.invoke('cache-foliage-lookup', key),
  cacheFoliageStore:         (key, data) => ipcRenderer.invoke('cache-foliage-store', key, data),
  cacheBuildingsLookup:      (key)     => ipcRenderer.invoke('cache-buildings-lookup', key),
  cacheBuildingsStore:       (key, data) => ipcRenderer.invoke('cache-buildings-store', key, data),
  cacheGetStats:         ()        => ipcRenderer.invoke('cache-get-stats'),
  cachePurgeElevations:  ()        => ipcRenderer.invoke('cache-purge-elevations'),
  cachePurgeFoliage:     ()        => ipcRenderer.invoke('cache-purge-foliage'),
  cachePurgeBuildings:   ()        => ipcRenderer.invoke('cache-purge-buildings'),
  cacheVacuum:           ()        => ipcRenderer.invoke('cache-vacuum'),
  saveScreenshot:        ()        => ipcRenderer.invoke('save-screenshot'),
  wsRepeatersLoad:  ()     => ipcRenderer.invoke('ws-repeaters-load'),
  wsRepeatersSave:  (rows) => ipcRenderer.invoke('ws-repeaters-save', rows),
  wsRepeatersClear: ()     => ipcRenderer.invoke('ws-repeaters-clear'),
});
