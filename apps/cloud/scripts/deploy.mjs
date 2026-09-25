// Applies D1 migrations, then deploys, using the wrangler.deploy.json from deployment-config.mjs.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const configPath = new URL("../wrangler.deploy.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
const database = config.d1_databases?.[0]?.database_name;
if (!database) throw new Error("Run just deploy-config <environment> first");
const cwd = new URL("..", import.meta.url);
const wrangler = (...args) =>
  execFileSync("pnpm", ["exec", "wrangler", ...args, "--config", "wrangler.deploy.json"], {
    cwd,
    stdio: "inherit",
  });
wrangler("d1", "migrations", "apply", database, "--remote");
wrangler("deploy");
const secrets = JSON.parse(
  execFileSync("pnpm", ["exec", "wrangler", "secret", "list", "--config", "wrangler.deploy.json"], {
    cwd,
    encoding: "utf8",
  }),
);
if (!secrets.some((secret) => secret.name === "WORKOS_API_KEY"))
  console.warn(
    "WORKOS_API_KEY is not set; the Worker refuses every request until it is. See DEPLOYMENT.md.",
  );
