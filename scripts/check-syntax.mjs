import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const files = ['main.js', 'preload.js', 'app.js'];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(root, full).replaceAll('\\', '/');
    if (rel.startsWith('node_modules/') || rel.startsWith('vendor/')) continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.js')) files.push(rel);
  }
}

walk(join(root, 'src'));

for (const file of [...new Set(files)]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
