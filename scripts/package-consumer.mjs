import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { linkControllerRequestSchema, routes } from "@origin89/cloud";

const deviceId = "00112233445566778899aabbccddeeff";
assert.equal(routes.account, "/v1/account");
assert.equal(
  linkControllerRequestSchema.safeParse({ deviceId, epoch: 1, name: "Barn" }).success,
  true,
);
assert.equal(
  linkControllerRequestSchema.safeParse({ deviceId, epoch: 1, name: "Barn", printedSecret: "x" })
    .success,
  false,
);
const entry = new URL(import.meta.resolve("@origin89/cloud"));
assert.ok((await readFile(new URL("./index.d.ts", entry), "utf8")).length > 0);
const schema = JSON.parse(
  await readFile(new URL(import.meta.resolve("@origin89/cloud/schema.json")), "utf8"),
);
assert.deepEqual(schema.$defs.LinkControllerRequest.required, ["deviceId", "epoch", "name"]);
assert.equal(schema.$defs.LinkControllerRequest.additionalProperties, false);
console.log("Installed package exports, schemas, JSON Schema and declarations passed.");
