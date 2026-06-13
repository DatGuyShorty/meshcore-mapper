import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Phase 0b of REWRITE.md — full electron-vite migration.
//
// Builds three targets into out/: main (out/main/index.js), preload
// (out/preload/index.js), renderer (out/renderer/). main.ts repoints the boot
// to the dev-server URL (ELECTRON_RENDERER_URL) in `electron-vite dev`, or to
// out/renderer/index.html in production.
//
// Main + preload keep `dependencies` external (externalizeDepsPlugin) so
// runtime `require('sql.js')` / `require('js-yaml')` still resolve from
// node_modules — critical for sql.js's wasm locateFile in src/main/cacheDb.js.
//
// Preload output is forced to CommonJS: the BrowserWindow runs with
// `sandbox: true`, and sandboxed preloads must be CJS.

const root = dirname(fileURLToPath(import.meta.url));

/** Static assets the renderer needs verbatim in out/renderer/. */
const VERBATIM_TAGS = [
  { tag: 'link', attrs: { rel: 'stylesheet', href: 'vendor/leaflet.css' }, injectTo: 'head' },
  { tag: 'link', attrs: { rel: 'stylesheet', href: 'style.css' }, injectTo: 'head' },
  { tag: 'script', attrs: { src: 'vendor/leaflet.js' }, injectTo: 'body' },
];

/**
 * Renderer plugin: strip the three.js importmap (three is bundled), keep
 * leaflet a window.L global (copied verbatim, re-injected so Vite's import
 * analysis never rewrites it), and relax the built CSP's script-src (no inline
 * scripts ship in the bundle). shellInit is now a normal TypeScript module
 * loaded from index.html.
 */
const rendererStaticAssets = {
  name: 'meshcore-renderer-static-assets',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      return {
        html: html
          .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '')
          .replace(/\s*<link rel="stylesheet" href="vendor\/leaflet\.css"\s*\/?>/, '')
          .replace(/\s*<link rel="stylesheet" href="style\.css"\s*\/?>/, '')
          .replace(/\s*<script src="vendor\/leaflet\.js"><\/script>/, '')
          .replace(/\s*<script src="src\/shellInit\.js"><\/script>/, '')
          .replace(/script-src 'self' 'sha256-[^']+'/, "script-src 'self'"),
        tags: VERBATIM_TAGS,
      };
    },
  },
  closeBundle() {
    const dist = resolve(root, 'out/renderer');
    mkdirSync(dist, { recursive: true });
    cpSync(resolve(root, 'vendor'), resolve(dist, 'vendor'), { recursive: true });
    cpSync(resolve(root, 'style.css'), resolve(dist, 'style.css'));

    // Vite tags the emitted module script + stylesheet with `crossorigin`.
    // On file:// that forces CORS mode against an opaque origin, so Chromium
    // refuses to load the bundle and the renderer comes up blank. Every asset
    // here is local — strip crossorigin so file:// loads them directly.
    const indexPath = resolve(dist, 'index.html');
    const html = readFileSync(indexPath, 'utf8').replace(/ crossorigin/g, '');
    writeFileSync(indexPath, html);
  },
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      lib: { entry: resolve(root, 'main.ts') },
      // src/main/*.js helpers are still CommonJS. Vite's bundled commonjs
      // plugin only transforms node_modules by default, so include our helper
      // sources while this last main-process directory migrates.
      commonjsOptions: { include: [/node_modules/, /src[/\\]main/] },
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: resolve(root, 'preload.ts') },
      // Sandboxed preload must be CommonJS.
      rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } },
    },
  },
  renderer: {
    root: '.',
    base: './',
    build: {
      outDir: 'out/renderer',
      emptyOutDir: true,
      modulePreload: { polyfill: false },
      target: 'es2022',
      rollupOptions: { input: resolve(root, 'index.html') },
    },
    worker: { format: 'es' },
    plugins: [rendererStaticAssets],
  },
});
