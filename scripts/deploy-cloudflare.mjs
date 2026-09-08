/**
 * Vendor-neutral deploy to your own Cloudflare account.
 *
 * The project's normal `npm run build` (vinext) emits a ready-to-run Worker at
 * `dist/server/index.js` plus a `dist/server/wrangler.json` whose D1/R2 binding
 * names are placeholders. This script rebuilds, rewrites that emitted config
 * with YOUR resource names, and runs `wrangler deploy`.
 *
 * One-time setup (see README "Deploy B — your own Cloudflare account"):
 *   npx wrangler login
 *   npx wrangler d1 create clause-db          # copy the database_id it prints
 *   npx wrangler r2 bucket create clause-files
 *   npx wrangler d1 execute clause-db --remote --file drizzle/0000_medical_betty_ross.sql
 *   npx wrangler secret put GEMINI_API_KEY --name clause    # + RESEND_API_KEY if using email
 *
 * Then set these (shell env, or a git-ignored `.dev.vars`) and run `npm run deploy:cf`:
 *   CF_WORKER_NAME   default: clause
 *   CF_D1_NAME       default: clause-db
 *   CF_D1_ID         required — the database_id from `wrangler d1 create`
 *   CF_R2_BUCKET     default: clause-files
 *   APP_URL          your deployed origin, e.g. https://clause.<subdomain>.workers.dev
 *   GEMINI_MODEL, GEMINI_EMBEDDING_MODEL, EMAIL_FROM   optional, passed as vars
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

// Load a local .dev.vars (KEY=value) into process.env without extra deps.
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const workerName = env.CF_WORKER_NAME || 'clause';
const d1Name = env.CF_D1_NAME || 'clause-db';
const d1Id = env.CF_D1_ID;
const r2Bucket = env.CF_R2_BUCKET || 'clause-files';

if (!d1Id) {
  console.error('\n✗ CF_D1_ID is not set. Run `npx wrangler d1 create clause-db` and set CF_D1_ID to the printed database_id.\n');
  process.exit(1);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });

console.log('▸ Building (vinext)…');
run('npm', ['run', 'build']);

const configPath = 'dist/server/wrangler.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));

config.name = workerName;
config.topLevelName = workerName;
config.d1_databases = [{ binding: 'DB', database_name: d1Name, database_id: d1Id }];
config.r2_buckets = [{ binding: 'BUCKET', bucket_name: r2Bucket }];
// Non-secret runtime config travels as plain vars; API keys stay as `wrangler secret`.
config.vars = {
  ...(env.APP_URL ? { APP_URL: env.APP_URL } : {}),
  ...(env.GEMINI_MODEL ? { GEMINI_MODEL: env.GEMINI_MODEL } : {}),
  ...(env.GEMINI_EMBEDDING_MODEL ? { GEMINI_EMBEDDING_MODEL: env.GEMINI_EMBEDDING_MODEL } : {}),
  ...(env.EMAIL_FROM ? { EMAIL_FROM: env.EMAIL_FROM } : {}),
};

writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`▸ Patched ${configPath} → worker "${workerName}", D1 "${d1Name}", R2 "${r2Bucket}"`);

console.log('▸ Deploying (wrangler)…');
run('npx', ['wrangler', 'deploy'], { cwd: 'dist/server' });

console.log('\n✓ Deployed. If this is the first deploy, make sure you have run:');
console.log('    npx wrangler d1 execute ' + d1Name + ' --remote --file drizzle/0000_medical_betty_ross.sql');
console.log('    npx wrangler secret put GEMINI_API_KEY --name ' + workerName + '\n');
