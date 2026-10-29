#!/usr/bin/env node
// Build the deployable wrangler config from environment variables so account ids
// and database ids never live in the repository.
//
//   CLOUDFLARE_ACCOUNT_ID   account that owns the Worker
//   CLOUDFLARE_API_TOKEN    used to look up the ids below when they are not passed
//   D1_DATABASE_ID          D1 database id (falls back to the database named kiumi)
//   KIUMI_VPC_SERVICE_ID    VPC service id (falls back to the service named kiumi-data)
//   KIUMI_DATA_ORIGIN       public origin of the data service (optional)
//   R2_BUCKET_NAME          R2 bucket name (optional; omit to deploy without R2)
//
// Output: apps/edge/wrangler.generated.jsonc (gitignored)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const base = readFileSync(path.join(root, 'apps/edge/wrangler.jsonc'), 'utf8');

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const dataOrigin = process.env.KIUMI_DATA_ORIGIN;
const r2 = process.env.R2_BUCKET_NAME;

const missing = [];
if (!account) missing.push('CLOUDFLARE_ACCOUNT_ID');
if (missing.length) {
  console.error(`missing env: ${missing.join(', ')}`);
  process.exit(1);
}

// Values that are not passed in are looked up through the API with the token the
// build already carries, so no id has to be stored in the repository.
const token = process.env.CLOUDFLARE_API_TOKEN;

async function api(pathname) {
  if (!token) return null;
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.result ?? null;
}

async function resolveD1() {
  if (process.env.D1_DATABASE_ID) return process.env.D1_DATABASE_ID;
  const list = await api(`/accounts/${account}/d1/database`);
  return Array.isArray(list) ? list.find((entry) => entry.name === 'kiumi')?.uuid ?? null : null;
}

async function resolveVpc() {
  if (process.env.KIUMI_VPC_SERVICE_ID) return process.env.KIUMI_VPC_SERVICE_ID;
  const list = await api(`/accounts/${account}/connectivity/directory/services`);
  return Array.isArray(list) ? list.find((entry) => entry.name === 'kiumi-data')?.service_id ?? null : null;
}

const d1 = await resolveD1();
const vpc = await resolveVpc();

if (!d1) {
  console.error('cannot resolve the D1 database: pass D1_DATABASE_ID or CLOUDFLARE_API_TOKEN');
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
