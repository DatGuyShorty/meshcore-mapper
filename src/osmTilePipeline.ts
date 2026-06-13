export type OsmTileProgress = {
  completed: number;
  total: number;
};

export type OsmTileBatchResult<TTile, TData> = {
  tile: TTile;
  data: TData;
};

export type OsmTileBatchOptions<TTile, TData> = {
  signal?: AbortSignal | null;
  tileConcurrency?: number;
  loadTile: (tile: TTile) => Promise<TData | null | undefined>;
  onProgress?: ((progress: OsmTileProgress) => void) | null;
  onTileError?: ((err: Error, tile: TTile) => void) | null;
};

type CancelledError = Error & {
  cancelled?: boolean;
};

export async function fetchOsmTileBatch<TTile, TData>(
  tiles: TTile[],
  {
    signal = null,
    tileConcurrency = 3,
    loadTile,
    onProgress = null,
    onTileError = null,
  }: OsmTileBatchOptions<TTile, TData> = {} as OsmTileBatchOptions<TTile, TData>,
): Promise<Array<OsmTileBatchResult<TTile, TData>>> {
  const results: Array<OsmTileBatchResult<TTile, TData>> = [];
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
      } catch (rawErr) {
        const err = rawErr as CancelledError;
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

function _abortError(): CancelledError {
  const err = new Error('Cancelled') as CancelledError;
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}
