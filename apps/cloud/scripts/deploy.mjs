// Checks the target, applies D1 migrations, then deploys, using the wrangler.deploy.json from
// deployment-config.mjs. Nothing changes remotely until the database and secret are confirmed.
// A WORKOS_API_KEY in .env.<environment> is uploaded with the deployed version.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const environment = process.argv[2] ?? "";
const envFile = fileURLToPath(new URL(`../.env.${environment}`, import.meta.url));
if (!/^(staging|production)$/.test(environment)) throw new Error("Pass staging or production");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const apiKey = process.env.WORKOS_API_KEY || undefined;
if (apiKey !== undefined && !/^sk_\S+$/.test(apiKey)) throw new Error("Invalid WORKOS_API_KEY");

const configPath = new URL("../wrangler.deploy.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
const database = config.d1_databases?.[0];
if (!database?.database_name) throw new Error("Run just deploy-config <environment> first");
if (config.vars?.WORKOS_CLIENT_ID !== process.env.WORKOS_CLIENT_ID)
  throw new Error(`wrangler.deploy.json was not prepared for ${environment}`);
const cwd = new URL("..", import.meta.url);
const wrangler = (args, options = { stdio: "inherit" }) =>
  execFileSync("pnpm", ["exec", "wrangler", ...args, "--config", "wrangler.deploy.json"], {
    cwd,
    ...options,
  });
const output = (args) => JSON.parse(wrangler(args, { encoding: "utf8" }));

// The name and ID come from separate settings; a mismatch would migrate one database and bind
// another.
const info = output(["d1", "info", database.database_name, "--json"]);
if (info.uuid !== database.database_id)
  throw new Error(
    `CLOUD_DATABASE_ID does not belong to ${database.database_name}; nothing was deployed.`,
  );

if (!apiKey) {
  const secrets = output(["secret", "list", "--format", "json"]);
  if (!secrets.some((secret) => secret.name === "WORKOS_API_KEY"))
    throw new Error(
      `WORKOS_API_KEY is not set on ${config.name}; add it to .env.${environment}. Nothing was deployed.`,
    );
}

wrangler(["d1", "migrations", "apply", database.database_name, "--remote"]);
if (!apiKey) {
  wrangler(["deploy"]);
} else {
  const dir = await mkdtemp(join(tmpdir(), "cloud-secrets-"));
  const secretsFile = join(dir, "secrets.json");
  try {
    await writeFile(secretsFile, JSON.stringify({ WORKOS_API_KEY: apiKey }), { mode: 0o600 });
    wrangler(["deploy", "--secrets-file", secretsFile]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
