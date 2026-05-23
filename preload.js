const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile:    (jsonStr) => ipcRenderer.invoke('save-file', jsonStr),
  openFile:    ()        => ipcRenderer.invoke('open-file'),
  getPresets:  ()        => ipcRenderer.invoke('get-presets'),
  // SQLite cache
  cacheElevationsLookup:     (points)  => ipcRenderer.invoke('cache-elevations-lookup', points),
  cacheElevationsLookupBbox: (bbox)    => ipcRenderer.invoke('cache-elevations-lookup-bbox', bbox),
  cacheElevationsStore:      (entries) => ipcRenderer.invoke('cache-elevations-store', entries),
  cacheFoliageLookup:        (key)     => ipcRenderer.invoke('cache-foliage-lookup', key),
  cacheFoliageStore:         (key, data) => ipcRenderer.invoke('cache-foliage-store', key, data),
});
