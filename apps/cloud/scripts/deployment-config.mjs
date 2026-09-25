// Writes wrangler.deploy.json for one environment from apps/cloud/.env.<environment> or the
// process environment. Creates and deploys nothing.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "jsonc-parser";

/** Each environment accepts tokens from its own WorkOS client only. */
export const clientIds = {
  staging: "client_01M3C9M944Y53VA9PJRCW8T5S6",
  production: "client_01M3CC0Q23FPHK50YW1WXCNZ3S",
};

const patterns = {
  CLOUDFLARE_ACCOUNT_ID: /^[a-f0-9]{32}$/,
  CLOUD_WORKER_NAME: /^[a-z][a-z0-9-]{0,62}$/,
  CLOUD_HOSTNAME: /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/,
  CLOUD_DATABASE_NAME: /^[a-z][a-z0-9-]{0,62}$/,
  CLOUD_DATABASE_ID: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/,
  WORKOS_CLIENT_ID: /^client_[0-9A-Z]{26}$/,
  WORKOS_ISSUER: /^https:\/\/\S+$/,
  WORKOS_AUDIENCE: /^\S+$/,
};

export function cloudConfig(base, environment, env) {
  if (!Object.hasOwn(clientIds, environment))
    throw new Error(`Environment must be one of ${Object.keys(clientIds).join(", ")}`);
  const value = {};
  for (const [key, pattern] of Object.entries(patterns)) {
    if (typeof env[key] !== "string" || !pattern.test(env[key]))
      throw new Error(`Missing or invalid ${key}`);
    value[key] = env[key];
  }
  if (value.WORKOS_CLIENT_ID !== clientIds[environment])
    throw new Error(`WORKOS_CLIENT_ID is not the ${environment} client`);
  // Resource names carry their environment, so production values cannot name staging resources.
  for (const key of ["CLOUD_WORKER_NAME", "CLOUD_DATABASE_NAME"])
    if (!value[key].endsWith(`-${environment}`))
      throw new Error(`${key} must end with -${environment}`);
  if (
    value.CLOUD_HOSTNAME.split(".").some((label) => label.includes("staging")) !==
    (environment === "staging")
  )
    throw new Error(
      environment === "staging"
        ? "The staging CLOUD_HOSTNAME must contain staging"
        : "The production CLOUD_HOSTNAME must not contain staging",
    );
  const { $schema: _schema, ...config } = structuredClone(base);
  return {
    ...config,
    name: value.CLOUD_WORKER_NAME,
    account_id: value.CLOUDFLARE_ACCOUNT_ID,
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: value.CLOUD_HOSTNAME, custom_domain: true }],
    vars: {
      WORKOS_CLIENT_ID: value.WORKOS_CLIENT_ID,
      WORKOS_ISSUER: value.WORKOS_ISSUER,
      WORKOS_AUDIENCE: value.WORKOS_AUDIENCE,
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: value.CLOUD_DATABASE_NAME,
        database_id: value.CLOUD_DATABASE_ID,
        migrations_dir: "migrations",
      },
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const environment = process.argv[2] ?? "";
  const file = fileURLToPath(new URL(`../.env.${environment}`, import.meta.url));
  if (Object.hasOwn(clientIds, environment) && existsSync(file)) process.loadEnvFile(file);
  const errors = [];
  const base = parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"), errors);
  if (errors.length) throw new Error("Invalid Wrangler config");
  const config = cloudConfig(base, environment, process.env);
  await writeFile(
    new URL("../wrangler.deploy.json", import.meta.url),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  console.log(`Prepared ${config.name} for ${environment}; nothing created or deployed.`);
}
