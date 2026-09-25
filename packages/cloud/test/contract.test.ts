import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSiteRequestSchema,
  deviceIdSchema,
  epochSchema,
  linkControllerRequestSchema,
  routes,
} from "../src/index.ts";

const deviceId = "00112233445566778899aabbccddeeff";

test("a link carries the device, epoch and a trimmed name", () => {
  assert.deepEqual(linkControllerRequestSchema.parse({ deviceId, epoch: 1, name: " Cabin " }), {
    deviceId,
    epoch: 1,
    name: "Cabin",
  });
});

test("a link that also carries a setup secret or client key is rejected", () => {
  for (const extra of [{ printedSecret: "K7Q2" }, { clientKey: "00" }]) {
    assert.equal(
      linkControllerRequestSchema.safeParse({ deviceId, epoch: 1, name: "Cabin", ...extra })
        .success,
      false,
    );
  }
});

test("device ids are exactly sixteen lowercase hex bytes", () => {
  assert.equal(deviceIdSchema.safeParse(deviceId).success, true);
  assert.equal(deviceIdSchema.safeParse(deviceId.toUpperCase()).success, false);
  assert.equal(deviceIdSchema.safeParse(deviceId.slice(1)).success, false);
  assert.equal(deviceIdSchema.safeParse(`${deviceId}0`).success, false);
});

test("epochs span the nonzero u32 range", () => {
  assert.equal(epochSchema.safeParse(1).success, true);
  assert.equal(epochSchema.safeParse(0xffff_ffff).success, true);
  for (const epoch of [0, -1, 0x1_0000_0000, 1.5, "1"]) {
    assert.equal(epochSchema.safeParse(epoch).success, false, `epoch ${epoch}`);
  }
});

test("names must hold visible text within 80 characters", () => {
  assert.equal(createSiteRequestSchema.safeParse({ name: "x".repeat(80) }).success, true);
  assert.equal(createSiteRequestSchema.safeParse({ name: "x".repeat(81) }).success, false);
  assert.equal(createSiteRequestSchema.safeParse({ name: "   " }).success, false);
});

test("site ids are escaped into the controller route", () => {
  assert.equal(routes.siteControllers("a/b"), "/v1/sites/a%2Fb/controllers");
});
