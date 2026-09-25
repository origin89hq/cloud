import { env } from "cloudflare:test";
import { listSitesResponseSchema, siteSchema } from "@origin89/cloud";
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";
import { Store } from "../src/store.ts";
import { call, count, issuer, newSubject, services, token } from "./helpers.ts";

describe("sites", () => {
  it("creates a site with the caller as owner and lists it", async () => {
    const svc = services();
    const bearer = await token(newSubject());
    const created = await call(svc, "POST", "/v1/sites", {
      token: bearer,
      body: { name: " Camp " },
    });
    expect(created.status).toBe(201);
    const site = siteSchema.parse(await created.json());
    expect(site).toMatchObject({ name: "Camp", role: "owner", controllers: [] });

    const listed = await call(svc, "GET", "/v1/sites", { token: bearer });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("no-store");
    expect(listSitesResponseSchema.parse(await listed.json())).toEqual({ sites: [site] });
  });

  it("lists nothing for a new account, and creates no user just to list", async () => {
    const subject = newSubject();
    const response = await call(services(), "GET", "/v1/sites", { token: await token(subject) });
    expect(await response.json()).toEqual({ sites: [] });
    expect(await count("identities", "subject = ?", subject)).toBe(0);
  });

  it("never shows one person's sites to another", async () => {
    const svc = services();
    await call(svc, "POST", "/v1/sites", {
      token: await token(newSubject()),
      body: { name: "Private" },
    });
    const response = await call(svc, "GET", "/v1/sites", { token: await token(newSubject()) });
    expect(await response.json()).toEqual({ sites: [] });
  });

  it("rejects invalid names, unknown fields, bad JSON and oversized bodies", async () => {
    const svc = services();
    const bearer = await token(newSubject());
    for (const body of [
      { name: "" },
      { name: "x".repeat(81) },
      { name: "Camp", owner: "me" },
      [],
    ]) {
      const response = await call(svc, "POST", "/v1/sites", { token: bearer, body });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_request" } });
    }
    expect((await call(svc, "POST", "/v1/sites", { token: bearer, body: "{" })).status).toBe(400);
    const large = { name: "Camp", padding: "x".repeat(5_000) };
    expect((await call(svc, "POST", "/v1/sites", { token: bearer, body: large })).status).toBe(413);
  });

  it("maps one identity to one user under concurrent first requests", async () => {
    const subject = newSubject();
    const store = new Store(env.DB);
    const users = await Promise.all(
      Array.from({ length: 5 }, () => store.resolveUser({ issuer, subject })),
    );
    expect(new Set(users).size).toBe(1);
    expect(await count("identities", "subject = ?", subject)).toBe(1);
    expect(await count("users", "id = ?", users[0])).toBe(1);
  });

  it("keeps the same subject from another issuer as a separate person", async () => {
    const subject = newSubject();
    const store = new Store(env.DB);
    const first = await store.resolveUser({ issuer, subject });
    const second = await store.resolveUser({ issuer: "https://other.example", subject });
    expect(first).not.toBe(second);
  });
});

describe("routing", () => {
  it("answers 404 for unknown paths and 405 with Allow for wrong methods", async () => {
    const svc = services();
    expect((await call(svc, "GET", "/v2/sites")).status).toBe(404);
    const response = await call(svc, "PUT", "/v1/sites");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect((await call(svc, "GET", "/v1/account")).headers.get("allow")).toBe("DELETE");
  });

  it("fails closed when WorkOS settings are missing", async () => {
    const response = await worker.fetch(new Request("https://cloud.test/v1/sites"), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "internal" } });
  });
});
