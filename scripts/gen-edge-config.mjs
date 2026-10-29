#!/usr/bin/env node
// Build the deployable wrangler config from environment variables so account ids
// and database ids never live in the repository.
//
//   CLOUDFLARE_ACCOUNT_ID   account that owns the Worker
//   D1_DATABASE_ID          D1 database id (from `wrangler d1 create`)
//   KIUMI_DATA_ORIGIN       public origin of the data service (optional)
//   R2_BUCKET_NAME          R2 bucket name (optional; omit to deploy without R2)
//
// Output: apps/edge/wrangler.generated.jsonc (gitignored)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = readFileSync(path.join(root, 'apps/edge/wrangler.jsonc'), 'utf8');

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const d1 = process.env.D1_DATABASE_ID;
const dataOrigin = process.env.KIUMI_DATA_ORIGIN;
const r2 = process.env.R2_BUCKET_NAME;
const vpc = process.env.KIUMI_VPC_SERVICE_ID;

const missing = [];
if (!account) missing.push('CLOUDFLARE_ACCOUNT_ID');
if (!d1) missing.push('D1_DATABASE_ID');
if (missing.length) {
  console.error(`missing env: ${missing.join(', ')}`);
  process.exit(1);
}

let out = base
  .replace('"REPLACE_WITH_ACCOUNT_ID"', JSON.stringify(account))
  .replace('"REPLACE_AT_BUILD_TIME"', JSON.stringify(d1));

if (!out.includes(account)) {
  out = out.replace('"name": "kiumi",', `"name": "kiumi",\n  "account_id": ${JSON.stringify(account)},`);
}

if (r2) out = out.replace('"REPLACE_WITH_BUCKET"', JSON.stringify(r2));
else out = out.replace(/^.*"r2_buckets".*$/m, '  // r2 disabled for this deployment');

if (dataOrigin) out = out.replace('"REPLACE_WITH_DATA_ORIGIN"', JSON.stringify(dataOrigin));

if (vpc) out = out.replace('"REPLACE_WITH_VPC_SERVICE_ID"', JSON.stringify(vpc));
else out = out.replace(/^\s*"vpc_services": \[[\s\S]*?\],\n/m, '');

writeFileSync(path.join(root, 'apps/edge/wrangler.generated.jsonc'), out);
console.log('wrote apps/edge/wrangler.generated.jsonc');
