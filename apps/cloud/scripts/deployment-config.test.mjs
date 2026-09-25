import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIds, cloudConfig } from "./deployment-config.mjs";

const base = { $schema: "x", name: "origin89-cloud", main: "src/index.ts", workers_dev: true };
const env = (environment, overrides = {}) => ({
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  CLOUD_WORKER_NAME: `origin89-cloud-${environment}`,
  CLOUD_HOSTNAME: "cloud.origin89.com",
  CLOUD_DATABASE_NAME: `origin89-cloud-${environment}`,
  CLOUD_DATABASE_ID: "01234567-89ab-cdef-0123-456789abcdef",
  WORKOS_CLIENT_ID: clientIds[environment],
  WORKOS_ISSUER: "https://auth.origin89.com",
  WORKOS_AUDIENCE: "https://cloud.origin89.com",
  ...overrides,
});

test("builds a closed Worker config with the environment's WorkOS client", () => {
  const config = cloudConfig(base, "production", env("production"));
  assert.equal(config.$schema, undefined);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, [{ pattern: "cloud.origin89.com", custom_domain: true }]);
  assert.equal(config.vars.WORKOS_CLIENT_ID, clientIds.production);
  assert.equal(config.vars.WORKOS_API_KEY, undefined);
  assert.equal(config.d1_databases[0].database_name, "origin89-cloud-production");
});

test("refuses the other environment's client ID", () => {
  assert.throws(
    () =>
      cloudConfig(base, "production", env("production", { WORKOS_CLIENT_ID: clientIds.staging })),
    /not the production client/,
  );
});

test("refuses missing or malformed values", () => {
  assert.throws(
    () => cloudConfig(base, "staging", env("staging", { WORKOS_ISSUER: "" })),
    /WORKOS_ISSUER/,
  );
  assert.throws(
    () =>
      cloudConfig(base, "staging", env("staging", { WORKOS_ISSUER: "http://auth.origin89.com" })),
    /WORKOS_ISSUER/,
  );
  assert.throws(
    () => cloudConfig(base, "staging", env("staging", { CLOUD_DATABASE_ID: "abc" })),
    /CLOUD_DATABASE_ID/,
  );
});

test("refuses an unknown environment", () => {
  assert.throws(() => cloudConfig(base, "preview", env("staging")), /Environment must be/);
});
