import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const migrations = (await readdir('drizzle')).filter(f => f.endsWith('.sql')).sort();
for (const file of migrations) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--file', `drizzle/${file}`, '--config', 'wrangler.local.json'], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: '.wrangler/logs' } });
  if (result.status) process.exit(result.status);
}
