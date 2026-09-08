// One-command deploy to Cloudflare Workers. Reads config from the environment (or
// a git-ignored .dev.vars), provisions the D1 database and R2 bucket if they are
// missing, applies the schema once, builds, deploys, and sets the API key(s) as
// Worker secrets. Nothing secret is written to disk.
//
//   CLOUDFLARE_API_TOKEN   required  (Workers Scripts, D1, R2 Storage: Edit)
//   CLOUDFLARE_ACCOUNT_ID  required
//   GEMINI_API_KEY         required  (set as a Worker secret, not a var)
//   RESEND_API_KEY         optional  (share-invite emails)
//   EMAIL_FROM, APP_URL    optional  (APP_URL defaults to the deployed URL)
//   CF_WORKER_NAME=clause  CF_D1_NAME=clause-db  CF_R2_BUCKET=clause-files
//   GEMINI_MODEL, GEMINI_EMBEDDING_MODEL  optional model overrides
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const env = process.env;
const need = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'GEMINI_API_KEY'].filter(k => !env[k]);
if (need.length) { console.error(`\nMissing required env: ${need.join(', ')}\n`); process.exit(1); }

const worker = env.CF_WORKER_NAME || 'clause';
const d1Name = env.CF_D1_NAME || 'clause-db';
const r2Name = env.CF_R2_BUCKET || 'clause-files';
const migration = 'drizzle/0000_medical_betty_ross.sql';
const wrangler = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { shell: process.platform === 'win32', encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts });
const step = msg => console.log(`\n▸ ${msg}`);

step('Building');
execFileSync('npm', ['run', 'build'], { shell: process.platform === 'win32', stdio: 'inherit' });

step(`Ensuring D1 database "${d1Name}"`);
let dbs = JSON.parse(wrangler(['d1', 'list', '--json']) || '[]');
if (!dbs.some(d => d.name === d1Name)) {
  wrangler(['d1', 'create', d1Name], { stdio: 'inherit' });
  dbs = JSON.parse(wrangler(['d1', 'list', '--json']) || '[]');
}
const d1Id = dbs.find(d => d.name === d1Name)?.uuid;
if (!d1Id) { console.error('Could not resolve the D1 database id.'); process.exit(1); }

step(`Ensuring R2 bucket "${r2Name}"`);
try { wrangler(['r2', 'bucket', 'create', r2Name], { stdio: 'inherit' }); }
catch { console.log('  (bucket already exists)'); }

step('Applying schema (first run only)');
const existing = JSON.parse(wrangler(['d1', 'execute', d1Name, '--remote', '--json', '--command', "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"]) || '[]');
if (existing[0]?.results?.length) console.log('  (schema already present)');
else wrangler(['d1', 'execute', d1Name, '--remote', '--yes', '--file', migration], { stdio: 'inherit' });

const patch = appUrl => {
  const cfg = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
  cfg.name = cfg.topLevelName = worker;
  cfg.d1_databases = [{ binding: 'DB', database_name: d1Name, database_id: d1Id }];
  cfg.r2_buckets = [{ binding: 'BUCKET', bucket_name: r2Name }];
  cfg.vars = {
    ...(appUrl ? { APP_URL: appUrl } : {}),
    ...(env.GEMINI_MODEL ? { GEMINI_MODEL: env.GEMINI_MODEL } : {}),
    ...(env.GEMINI_EMBEDDING_MODEL ? { GEMINI_EMBEDDING_MODEL: env.GEMINI_EMBEDDING_MODEL } : {}),
    ...(env.EMAIL_FROM ? { EMAIL_FROM: env.EMAIL_FROM } : {}),
  };
  writeFileSync('dist/server/wrangler.json', JSON.stringify(cfg, null, 2));
};
const deploy = () => wrangler(['deploy'], { cwd: 'dist/server' });

step('Deploying');
patch(env.APP_URL);
let out = deploy();
const url = (out.match(/https:\/\/[\w.-]+\.workers\.dev/) || [])[0];
if (url && !env.APP_URL) { step('Setting APP_URL to the deployed origin'); patch(url); out = deploy(); }

step('Setting Worker secrets');
const putSecret = (name, value) => wrangler(['secret', 'put', name, '--name', worker], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
putSecret('GEMINI_API_KEY', env.GEMINI_API_KEY);
if (env.RESEND_API_KEY) putSecret('RESEND_API_KEY', env.RESEND_API_KEY);

console.log(`\n✓ Live at ${url || '(see the URL printed above)'}\n`);
