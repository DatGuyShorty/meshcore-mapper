import { describe, expect, it } from 'vitest';
import { fetchOsmTileBatch } from '../../src/osmTilePipeline.js';

describe('OSM tile pipeline', () => {
  it('loads tiles with bounded concurrency and reports progress', async () => {
    const progress = [];
    const results = await fetchOsmTileBatch([
      { key: 'a' },
      { key: 'b' },
      { key: 'c' },
    ], {
      tileConcurrency: 2,
      loadTile: async tile => ({ key: tile.key }),
      onProgress: p => progress.push(p),
    });

    expect(results.map(r => r.data.key).sort()).toEqual(['a', 'b', 'c']);
    expect(progress[0]).toEqual({ completed: 0, total: 3 });
    expect(progress.at(-1)).toEqual({ completed: 3, total: 3 });
  });

  it('skips failed tiles without cancelling the whole batch', async () => {
    const failed = [];
    const results = await fetchOsmTileBatch([{ key: 'ok' }, { key: 'bad' }], {
      loadTile: async tile => {
        if (tile.key === 'bad') throw new Error('nope');
        return { key: tile.key };
      },
      onTileError: (err, tile) => failed.push({ err, tile }),
    });

    expect(results).toHaveLength(1);
    expect(results[0].data.key).toBe('ok');
    expect(failed).toHaveLength(1);
    expect(failed[0].tile.key).toBe('bad');
  });
});
