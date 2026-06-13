import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registerIpcHandlers } from '../../src/main/ipcHandlers.js';
const thisFile = fileURLToPath(import.meta.url);

function registerHandlers(cache = { db: null }) {
  const handlers = new Map();
  registerIpcHandlers({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    dialog: {},
    cache,
    presetsPath: thisFile,
  });
  return handlers;
}

describe('IPC payload validation', () => {
  it('ignores malformed cache payloads before touching SQLite statements', async () => {
    let prepared = 0;
    const cache = {
      db: {
        prepare() {
          prepared++;
          throw new Error('prepare should not be reached');
        },
        run() {},
      },
      scheduleSave() {},
    };
    const handlers = registerHandlers(cache);

    expect(await handlers.get('cache-elevations-lookup-bbox')(null, null)).toEqual([]);
    await handlers.get('cache-elevations-store')(null, null);
    await handlers.get('cache-elevations-store')(null, [{ lat: 95, lon: 0, elev: 1 }]);
    expect(await handlers.get('cache-dem-tile-get')(null, { source: '../bad', z: 12, x: 1, y: 1 })).toBeNull();
    await handlers.get('cache-dem-tile-store')(null, { source: 'terrarium', z: 'bad', x: 1, y: 1, data: [1] });
    expect(prepared).toBe(0);
  });

  it('rejects non-array WebSocket saves and filters invalid rows', async () => {
    const inserted = [];
    const runs = [];
    const cache = {
      db: {
        run(sql) { runs.push(sql); },
        prepare() {
          return {
            run(values) { inserted.push(values); },
            free() {},
          };
        },
      },
      scheduleSave() {},
    };
    const handlers = registerHandlers(cache);

    await handlers.get('ws-repeaters-save')(null, null);
    expect(runs).toEqual([]);

    await handlers.get('ws-repeaters-save')(null, [
      { name: 'ok', lat: 48, lon: 18, short: 'A' },
      { name: 'bad', lat: 200, lon: 18 },
    ]);

    expect(inserted).toHaveLength(1);
    expect(JSON.parse(inserted[0][0])).toMatchObject({ name: 'ok', lat: 48, lon: 18, short: 'A' });
  });

  it('preload CUDA progress subscriptions expose payloads instead of raw IPC events', () => {
    const source = readFileSync('preload.ts', 'utf8');

    expect(source).toContain('const wrapped: WrappedPayloadHandler = (_event, payload) => typedHandler(payload)');
    expect(source).toContain('cudaCoverageProgressHandlers');
    expect(source).toContain('cudaOptimizerProgressHandlers');
  });
});
