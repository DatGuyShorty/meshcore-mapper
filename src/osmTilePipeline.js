export async function fetchOsmTileBatch(tiles, {
  signal = null,
  tileConcurrency = 3,
  loadTile,
  onProgress = null,
  onTileError = null,
} = {}) {
  const results = [];
  let completed = 0;
  let nextIdx = 0;
  const workersLimit = Math.max(1, Math.min(12, Math.floor(tileConcurrency)));

  onProgress?.({ completed, total: tiles.length });

  const workers = Math.min(workersLimit, tiles.length || 1);
  const runWorker = async () => {
    for (;;) {
      if (signal?.aborted) throw _abortError();
      const idx = nextIdx++;
      if (idx >= tiles.length) return;
      const tile = tiles[idx];

      try {
        const data = await loadTile(tile);
        if (data) results.push({ tile, data });
      } catch (err) {
        if (err?.cancelled || err?.name === 'AbortError') throw err;
        onTileError?.(err, tile);
      }

      completed++;
      onProgress?.({ completed, total: tiles.length });
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return results;
}

function _abortError() {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
