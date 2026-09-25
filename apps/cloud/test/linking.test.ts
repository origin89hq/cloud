import { env } from "cloudflare:test";
import { controllerSchema, siteSchema } from "@origin89/cloud";
import { describe, expect, it } from "vitest";
import { freshSignInSeconds, type Services } from "../src/app.ts";
import { call, count, deviceId, FakeWorkos, newSubject, services, token } from "./helpers.ts";

async function owner(svc: Services, name = "Camp") {
  const subject = newSubject();
  const bearer = await token(subject);
  const response = await call(svc, "POST", "/v1/sites", { token: bearer, body: { name } });
  return { subject, bearer, site: siteSchema.parse(await response.json()) };
}

const link = (svc: Services, bearer: string, siteId: string, body: unknown) =>
  call(svc, "POST", `/v1/sites/${siteId}/controllers`, { token: bearer, body });

describe("linking a controller generation", () => {
  it("links the generation to the owner's site after a fresh sign-in check", async () => {
    const svc = services();
    const { subject, bearer, site } = await owner(svc);
    const id = deviceId();
    const response = await link(svc, bearer, site.id, { deviceId: id, epoch: 3, name: "Barn" });
    expect(response.status).toBe(201);
    const linked = controllerSchema.parse(await response.json());
    expect(linked).toMatchObject({ deviceId: id, epoch: 3, name: "Barn" });
    expect(svc.workos.sessionChecks).toEqual([
      { userId: subject, sessionId: `session_${subject}`, maxAgeSeconds: freshSignInSeconds },
    ]);
    const listed = await call(svc, "GET", "/v1/sites", { token: bearer });
    expect(await listed.json()).toEqual({ sites: [{ ...site, controllers: [linked] }] });
  });

  it("returns the stored link unchanged when the same site links it again", async () => {
    const svc = services();
    const { bearer, site } = await owner(svc);
    const body = { deviceId: deviceId(), epoch: 1, name: "Barn" };
    const first = controllerSchema.parse(await (await link(svc, bearer, site.id, body)).json());
    const again = await link(svc, bearer, site.id, { ...body, name: "Renamed" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(await count("controller_generations", "device_id = ?", body.deviceId)).toBe(1);
  });

  it("refuses another owner's generation and leaves it where it was", async () => {
    const svc = services();
    const first = await owner(svc);
    const second = await owner(svc);
    const body = { deviceId: deviceId(), epoch: 1, name: "Barn" };
    await link(svc, first.bearer, first.site.id, body);
    const response = await link(svc, second.bearer, second.site.id, body);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "generation_linked" } });
    expect(
      await count(
        "controller_generations",
        "device_id = ? AND site_id = ?",
        body.deviceId,
        first.site.id,
      ),
    ).toBe(1);
  });

  it("refuses moving a generation between the same owner's sites", async () => {
    const svc = services();
    const { bearer, site } = await owner(svc);
    const other = await call(svc, "POST", "/v1/sites", { token: bearer, body: { name: "Cabin" } });
    const otherSite = siteSchema.parse(await other.json());
    const body = { deviceId: deviceId(), epoch: 1, name: "Barn" };
    await link(svc, bearer, site.id, body);
    expect((await link(svc, bearer, otherSite.id, body)).status).toBe(409);
  });

  it("lets a new generation after a reset go to a new owner, keeping the old one", async () => {
    const svc = services();
    const seller = await owner(svc);
    const buyer = await owner(svc);
    const id = deviceId();
    await link(svc, seller.bearer, seller.site.id, { deviceId: id, epoch: 1, name: "Barn" });
    const response = await link(svc, buyer.bearer, buyer.site.id, {
      deviceId: id,
      epoch: 2,
      name: "Shed",
    });
    expect(response.status).toBe(201);
    const sellerSites = await (
      await call(svc, "GET", "/v1/sites", { token: seller.bearer })
    ).json();
    expect(sellerSites).toMatchObject({ sites: [{ controllers: [{ deviceId: id, epoch: 1 }] }] });
  });

  it("refuses an epoch older than one the site already holds", async () => {
    const svc = services();
    const { bearer, site } = await owner(svc);
    const id = deviceId();
    await link(svc, bearer, site.id, { deviceId: id, epoch: 5, name: "Barn" });
    const response = await link(svc, bearer, site.id, { deviceId: id, epoch: 4, name: "Barn" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "stale_epoch" } });
  });

  it("does not let a newer epoch on another site block the owner's link", async () => {
    const svc = services();
    const squatter = await owner(svc);
    const real = await owner(svc);
    const id = deviceId();
    const squat = { deviceId: id, epoch: 0xffff_ffff, name: "Mine" };
    expect((await link(svc, squatter.bearer, squatter.site.id, squat)).status).toBe(201);
    const response = await link(svc, real.bearer, real.site.id, {
      deviceId: id,
      epoch: 1,
      name: "Barn",
    });
    expect(response.status).toBe(201);
    expect(controllerSchema.parse(await response.json())).toMatchObject({ deviceId: id, epoch: 1 });
    expect(await count("controller_generations", "device_id = ?", id)).toBe(2);
    // The squatting site keeps only its own claim.
    const squatterSites = await (
      await call(svc, "GET", "/v1/sites", { token: squatter.bearer })
    ).json();
    expect(squatterSites).toMatchObject({
      sites: [{ controllers: [{ deviceId: id, epoch: 0xffff_ffff }] }],
    });
  });

  it("refuses an older epoch on a site that holds the newest epoch", async () => {
    const svc = services();
    const { bearer, site } = await owner(svc);
    const id = deviceId();
    await link(svc, bearer, site.id, { deviceId: id, epoch: 0xffff_ffff, name: "Barn" });
    const response = await link(svc, bearer, site.id, { deviceId: id, epoch: 1, name: "Barn" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "stale_epoch" } });
    expect(await count("controller_generations", "device_id = ?", id)).toBe(1);
  });

  it("hides sites the caller does not own", async () => {
    const svc = services();
    const { site } = await owner(svc);
    const admin = newSubject();
    const adminBearer = await token(admin);
    const adminUser = await svc.store.resolveUser({
      issuer: "https://auth.test.origin89.com",
      subject: admin,
    });
    await env.DB.prepare(
      "INSERT INTO memberships (site_id, user_id, role, created_at) VALUES (?, ?, 'admin', 0)",
    )
      .bind(site.id, adminUser)
      .run();
    const body = { deviceId: deviceId(), epoch: 1, name: "Barn" };
    for (const [bearer, siteId] of [
      [adminBearer, site.id],
      [await (await owner(svc)).bearer, site.id],
      [adminBearer, crypto.randomUUID()],
      [adminBearer, "not-a-uuid"],
    ] as const) {
      const response = await link(svc, bearer, siteId, body);
      expect(response.status).toBe(404);
    }
    expect(await count("controller_generations", "device_id = ?", body.deviceId)).toBe(0);
  });

  it("rejects a link carrying a setup secret or client key, or a malformed identity", async () => {
    const svc = services();
    const { bearer, site } = await owner(svc);
    const valid = { deviceId: deviceId(), epoch: 1, name: "Barn" };
    for (const body of [
      { ...valid, printedSecret: "K7Q2-M4XP" },
      { ...valid, clientKey: "00".repeat(32) },
      { ...valid, deviceId: valid.deviceId.toUpperCase() },
      { ...valid, epoch: 0 },
      { ...valid, epoch: 2 ** 32 },
      { deviceId: valid.deviceId, epoch: 1 },
    ]) {
      const response = await link(svc, bearer, site.id, body);
      expect(response.status).toBe(400);
    }
    expect(await count("controller_generations", "device_id = ?", valid.deviceId)).toBe(0);
    expect(svc.workos.sessionChecks).toEqual([]);
  });

  it("asks for a fresh sign-in when the session is old, and links nothing", async () => {
    const workos = new FakeWorkos();
    workos.session = { kind: "stale" };
    const svc = services(workos);
    const { bearer, site } = await owner(svc);
    const body = { deviceId: deviceId(), epoch: 1, name: "Barn" };
    const response = await link(svc, bearer, site.id, body);
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer error="insufficient_user_authentication", max_age=${freshSignInSeconds}`,
    );
    expect(await response.json()).toMatchObject({ error: { code: "reauthentication_required" } });
    expect(await count("controller_generations", "device_id = ?", body.deviceId)).toBe(0);
  });

  it("answers 503 and links nothing when WorkOS cannot confirm the session", async () => {
    const workos = new FakeWorkos();
    workos.session = { kind: "unavailable" };
    const svc = services(workos);
    const { bearer, site } = await owner(svc);
    const body = { deviceId: deviceId(), epoch: 1, name: "Barn" };
    expect((await link(svc, bearer, site.id, body)).status).toBe(503);
    expect(await count("controller_generations", "device_id = ?", body.deviceId)).toBe(0);
  });
});
