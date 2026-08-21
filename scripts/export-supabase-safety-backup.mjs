#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputArgument = process.argv[2];
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!outputArgument) {
  throw new Error("Usage: export-supabase-safety-backup.mjs <output-directory>");
}

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}

const outputDirectory = resolve(outputArgument);
await mkdir(outputDirectory, { recursive: false, mode: 0o700 });

const headers = {
  Accept: "application/json",
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
};

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${url}: ${body.slice(0, 500)}`);
  }
  return body ? JSON.parse(body) : null;
}

async function writeJson(name, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(resolve(outputDirectory, name), serialized, { mode: 0o600 });
  return {
    bytes: Buffer.byteLength(serialized),
    sha256: createHash("sha256").update(serialized).digest("hex"),
  };
}

const openApi = await fetchJson(`${supabaseUrl}/rest/v1/`, {
  headers: { Accept: "application/openapi+json" },
});
const tableNames = Object.entries(openApi.paths ?? {})
  .filter(([path, operations]) =>
    path !== "/" &&
    path.startsWith("/") &&
    !path.startsWith("/rpc/") &&
    Boolean(operations?.get),
  )
  .map(([path]) => path.slice(1))
  .sort();

const manifest = {
  createdAt: new Date().toISOString(),
  projectUrl: supabaseUrl,
  tables: {},
  authUsers: null,
};

for (const tableName of tableNames) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await fetchJson(
      `${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}?select=*`,
      { headers: { Range: `${offset}-${offset + 999}` } },
    );
    if (!Array.isArray(page)) {
      throw new Error(`Expected an array while exporting ${tableName}.`);
    }
    rows.push(...page);
    if (page.length < 1000) break;
  }
  const fileName = `public.${tableName}.json`;
  manifest.tables[tableName] = {
    file: fileName,
    rows: rows.length,
    ...(await writeJson(fileName, rows)),
  };
}

const authUsers = [];
for (let page = 1; ; page += 1) {
  const result = await fetchJson(
    `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`,
  );
  authUsers.push(...result.users);
  if (result.users.length < 1000) break;
}
manifest.authUsers = {
  file: "auth.users.json",
  rows: authUsers.length,
  ...(await writeJson("auth.users.json", authUsers)),
};

await writeJson("manifest.json", manifest);
console.log(
  JSON.stringify({
    outputDirectory,
    tableCount: tableNames.length,
    authUserCount: authUsers.length,
    totalRows: Object.values(manifest.tables).reduce(
      (sum, table) => sum + table.rows,
      0,
    ),
  }),
);
