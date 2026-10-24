// Copies only the files Orca needs into plugin/, a symlink-free folder to install.
// Why: Orca refuses plugin folders with symlinks or more than 2,000 entries, and
// the repo root has node_modules (symlinks in .bin, thousands of files).
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'plugin');

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest);
for (const entry of ['orca-plugin.json', 'out', 'web', 'skills']) {
  cpSync(join(root, entry), join(dest, entry), { recursive: true });
}
console.log(`Staged plugin at ${dest}`);
