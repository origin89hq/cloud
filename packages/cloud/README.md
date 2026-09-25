# @origin89/cloud

The Origin89 cloud API contract. The service in `apps/cloud` and the apps build against the same zod schemas. `@origin89/cloud/schema.json` carries them as JSON Schema for clients without zod.

Pin an exact version. A breaking change to a request or response ships as a new major version of this package and, once clients depend on the old shape, a new route prefix.

| Method and path | Body | Success |
| --- | --- | --- |
| `GET /v1/sites` | none | `200` `ListSitesResponse` |
| `POST /v1/sites` | `CreateSiteRequest` | `201` `Site`, caller is `owner` |
| `POST /v1/sites/{siteId}/controllers` | `LinkControllerRequest` | `201` `Controller`; `200` when this site already holds the generation |
| `DELETE /v1/account` | none | `204` |

Every route needs `Authorization: Bearer <WorkOS access token>` from the client ID of the same environment. Linking and account deletion also need a sign-in within the last five minutes; otherwise the response is `401` with `reauthentication_required`. Errors use `ErrorResponse`.

A link grants no access to the controller: the controller decides who may operate it. An ownership generation is one `deviceId` and `epoch`. It belongs to one site; a factory reset starts a new epoch, which can be linked to a different site while the old generation keeps its history.
