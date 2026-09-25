// Checks the target, applies D1 migrations, then deploys, using the wrangler.deploy.json from
// deployment-config.mjs. Nothing changes remotely until the database and secret are confirmed.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const configPath = new URL("../wrangler.deploy.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
const database = config.d1_databases?.[0];
if (!database?.database_name) throw new Error("Run just deploy-config <environment> first");
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

const secrets = output(["secret", "list", "--format", "json"]);
if (!secrets.some((secret) => secret.name === "WORKOS_API_KEY"))
  throw new Error(
    `WORKOS_API_KEY is not set on ${config.name}; set it first (see DEPLOYMENT.md). Nothing was deployed.`,
  );

wrangler(["d1", "migrations", "apply", database.database_name, "--remote"]);
wrangler(["deploy"]);
