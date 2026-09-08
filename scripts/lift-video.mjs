// Copies the Playwright recording to recorded_video.webm in the repo root.
import { readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'recorded_video.webm';

const root = 'test-results';
let newest = null;
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) walk(full);
    else if (name.endsWith('.webm') && (!newest || s.mtimeMs > newest.mtime)) newest = { path: full, mtime: s.mtimeMs };
  }
};
try { walk(root); } catch { /* no test-results */ }

if (!newest) { console.error('No .webm recording found under test-results/.'); process.exit(1); }
copyFileSync(newest.path, OUT);
console.log('→ ' + OUT);
