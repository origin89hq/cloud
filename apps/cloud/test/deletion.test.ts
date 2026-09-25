import { env } from "cloudflare:test";
import { siteSchema } from "@origin89/cloud";
import { describe, expect, it } from "vitest";
import type { Services } from "../src/app.ts";
import {
  call,
  count,
  deviceId,
  FakeWorkos,
  issuer,
  newSubject,
  services,
  token,
} from "./helpers.ts";

async function account(svc: Services) {
  const subject = newSubject();
  const bearer = await token(subject);
  const created = await call(svc, "POST", "/v1/sites", { token: bearer, body: { name: "Camp" } });
  const site = siteSchema.parse(await created.json());
  const device = deviceId();
  await call(svc, "POST", `/v1/sites/${site.id}/controllers`, {
    token: bearer,
    body: { deviceId: device, epoch: 1, name: "Barn" },
  });
  const user = await svc.store.findUser({ issuer, subject });
  return { subject, bearer, site, device, user };
}

const deleteAccount = (svc: Services, bearer: string) =>
  call(svc, "DELETE", "/v1/account", { token: bearer });

describe("account deletion", () => {
  it("deletes the WorkOS user and every local record of the person", async () => {
    const svc = services();
    const { subject, bearer, site, device, user } = await account(svc);
    const response = await deleteAccount(svc, bearer);
    expect(response.status).toBe(204);
    expect(svc.workos.deleted).toEqual([subject]);
    expect(await count("users", "id = ?", user)).toBe(0);
    expect(await count("identities", "subject = ?", subject)).toBe(0);
    expect(await count("memberships", "user_id = ?", user)).toBe(0);
    expect(await count("sites", "id = ?", site.id)).toBe(0);
    expect(await count("controller_generations", "device_id = ?", device)).toBe(0);
  });

  it("keeps a shared site and its links for the remaining members", async () => {
    const svc = services();
    const { bearer, site, device, user } = await account(svc);
    const other = await svc.store.resolveUser({ issuer, subject: newSubject() });
    await env.DB.prepare(
      "INSERT INTO memberships (site_id, user_id, role, created_at) VALUES (?, ?, 'admin', 0)",
    )
      .bind(site.id, other)
      .run();
    expect((await deleteAccount(svc, bearer)).status).toBe(204);
    expect(await count("memberships", "site_id = ? AND user_id = ?", site.id, other)).toBe(1);
    expect(await count("memberships", "user_id = ?", user)).toBe(0);
    expect(
      await count("controller_generations", "device_id = ? AND linked_by IS NULL", device),
    ).toBe(1);
  });

  it("frees the generation so it can be linked again", async () => {
    const svc = services();
    const { bearer, device } = await account(svc);
    await deleteAccount(svc, bearer);
    const next = await account(svc);
    const response = await call(svc, "POST", `/v1/sites/${next.site.id}/controllers`, {
      token: next.bearer,
      body: { deviceId: device, epoch: 1, name: "Barn" },
    });
    expect(response.status).toBe(201);
  });

  it("asks for a fresh sign-in first and deletes nothing when the session is old", async () => {
    const svc = services();
    const { bearer, user } = await account(svc);
    svc.workos.session = { kind: "stale" };
    const response = await deleteAccount(svc, bearer);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "reauthentication_required" } });
    expect(svc.workos.deleted).toEqual([]);
    expect(await count("users", "id = ?", user)).toBe(1);
  });

  it("reports a WorkOS failure after removing local data, and a retry finishes", async () => {
    const workos = new FakeWorkos();
    const svc = services(workos);
    const { subject, bearer, user } = await account(svc);
    workos.deletion = { kind: "unavailable" };
    const failed = await deleteAccount(svc, bearer);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: { code: "provider_unavailable" } });
    expect(await count("users", "id = ?", user)).toBe(0);
    expect(workos.deleted).toEqual([]);

    workos.deletion = { kind: "deleted" };
    expect((await deleteAccount(svc, bearer)).status).toBe(204);
    expect(workos.deleted).toEqual([subject]);
  });

  it("deletes the WorkOS user even when no local record exists", async () => {
    const svc = services();
    const subject = newSubject();
    expect((await deleteAccount(svc, await token(subject))).status).toBe(204);
    expect(svc.workos.deleted).toEqual([subject]);
  });
});
