import type { App } from 'electron';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

type SqlValue = string | number | Uint8Array | null;
type SqlExecResult = { values: SqlValue[][] };
type SqlStatement = {
  bind(values: unknown[]): void;
  step(): boolean;
  getAsObject(): Record<string, any>;
  run(values: unknown[]): void;
  free(): void;
};
type SqlDatabase = {
  export(): Uint8Array;
  close(): void;
  exec(sql: string): SqlExecResult[];
  prepare(sql: string): SqlStatement;
  run(sql: string): void;
};
type SqlModule = {
  Database: new (data?: Uint8Array | Buffer) => SqlDatabase;
};
type InitSqlJs = (options: { locateFile(file: string): string }) => Promise<SqlModule>;

export type CacheDb = {
  readonly db: SqlDatabase | null;
  saveDb(): void;
  scheduleSave(): void;
  close(): void;
};

const initSqlJs = require('sql.js') as InitSqlJs;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function createCacheDb(app: App): Promise<CacheDb> {
  let db: SqlDatabase | null = null;
  const dbPath = path.join(app.getPath('userData'), 'cache.db');
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function saveDb(): void {
    if (!db || !dbPath) return;
    try {
      fs.writeFileSync(dbPath, Buffer.from(db.export()));
    } catch (err) {
      console.error('[cache] Failed to write cache.db:', errorMessage(err));
    }
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDb, 2000);
  }

  function close(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (db) {
      saveDb();
      db.close();
      db = null;
      console.log('[cache] cache.db saved and closed');
    }
  }

  const wasmDir = path.dirname(require.resolve('sql.js'));
  const SQL = await initSqlJs({ locateFile: f => path.join(wasmDir, f) });
  if (fs.existsSync(dbPath)) {
    console.log('[cache] Loading existing cache.db');
    const fileData = fs.readFileSync(dbPath);
    db = new SQL.Database(fileData);
    try {
      const check = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0];
      if (check !== 'ok') throw new Error(`integrity_check returned: ${check}`);
    } catch (intErr) {
      console.warn('[cache] DB corrupt - discarding and starting fresh:', errorMessage(intErr));
      db.close();
      db = new SQL.Database();
    }
  } else {
    console.log('[cache] Creating new cache.db');
    db = new SQL.Database();
  }

  // sql.js runs the DB entirely in WASM memory; these pragmas have no effect
  // on the in-memory engine and are kept only so the same SQL would also work
  // against a future native sqlite backend without dropping durability hints.
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA synchronous=NORMAL');
  db.run(`
    CREATE TABLE IF NOT EXISTS elevations (
      lat  REAL NOT NULL,
      lon  REAL NOT NULL,
      elev REAL NOT NULL,
      PRIMARY KEY (lat, lon)
    );
    CREATE TABLE IF NOT EXISTS dem_tiles (
      source    TEXT NOT NULL,
      z         INTEGER NOT NULL,
      x         INTEGER NOT NULL,
      y         INTEGER NOT NULL,
      data      BLOB NOT NULL,
      cached_at INTEGER NOT NULL,
      PRIMARY KEY (source, z, x, y)
    );
    CREATE TABLE IF NOT EXISTS foliage_cache (
      bbox_key  TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS buildings_cache (
      bbox_key  TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ws_repeaters (
      id        INTEGER PRIMARY KEY,
      data      TEXT NOT NULL,
      saved_at  INTEGER NOT NULL
    );
  `);

  return {
    get db() { return db; },
    saveDb,
    scheduleSave,
    close,
  };
}
