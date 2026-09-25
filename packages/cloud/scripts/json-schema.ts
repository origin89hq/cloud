// Writes the contract as JSON Schema for clients that cannot import zod, such as the iOS app.
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import * as contract from "../src/index.ts";

const schemas = {
  CreateSiteRequest: contract.createSiteRequestSchema,
  LinkControllerRequest: contract.linkControllerRequestSchema,
  Controller: contract.controllerSchema,
  Site: contract.siteSchema,
  ListSitesResponse: contract.listSitesResponseSchema,
  ErrorResponse: contract.errorResponseSchema,
};
const document = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
  ),
};
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../dist/schema.json", import.meta.url),
  `${JSON.stringify(document, null, 2)}\n`,
);
