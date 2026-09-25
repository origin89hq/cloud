import { z } from "zod";

/**
 * Version 1 of the Origin89 cloud API. Every route is under this prefix and
 * takes a WorkOS AuthKit access token as `Authorization: Bearer <token>`.
 *
 * Requests are strict: unknown fields are rejected, so a client cannot send a
 * printed setup secret or a client key alongside a link by mistake.
 */
export const apiPrefix = "/v1";

export const routes = {
  /** `GET` lists the caller's sites; `POST` creates one with the caller as owner. */
  sites: `${apiPrefix}/sites`,
  /** `POST` links a controller generation to a site the caller owns. */
  siteControllers: (siteId: string) =>
    `${apiPrefix}/sites/${encodeURIComponent(siteId)}/controllers`,
  /** `DELETE` deletes the WorkOS user and the caller's memberships. */
  account: `${apiPrefix}/account`,
} as const;

/** The KM43 controller identity: sixteen bytes in lowercase hex (P-038). */
export const deviceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, "Expected 32 lowercase hex digits");

/**
 * The KM43 epoch: a nonzero `u32` the controller advances on factory reset.
 * Each epoch of a `device_id` is a separate ownership generation.
 */
export const epochSchema = z.int().min(1).max(0xffff_ffff);

const displayName = z.string().trim().min(1).max(80);

export const siteNameSchema = displayName;
export const controllerNameSchema = displayName;

/** Site roles. `owner` is the person who paired first; everyone invited is `admin`. */
export const roleSchema = z.enum(["owner", "admin"]);

export const createSiteRequestSchema = z.strictObject({ name: siteNameSchema });

/**
 * Links a controller this phone is already enrolled with. It carries identity
 * and a display name only, never the printed secret or a client key, and it
 * grants no access to the controller.
 */
export const linkControllerRequestSchema = z.strictObject({
  deviceId: deviceIdSchema,
  epoch: epochSchema,
  name: controllerNameSchema,
});

const timestamp = z.iso.datetime();

/** One ownership generation of a controller, linked to a site. */
export const controllerSchema = z.strictObject({
  deviceId: deviceIdSchema,
  epoch: epochSchema,
  name: controllerNameSchema,
  linkedAt: timestamp,
});

export const siteSchema = z.strictObject({
  id: z.uuid(),
  name: siteNameSchema,
  role: roleSchema,
  createdAt: timestamp,
  controllers: z.array(controllerSchema),
});

export const listSitesResponseSchema = z.strictObject({ sites: z.array(siteSchema) });

export const errorCodes = [
  /** The bearer token is missing, malformed, expired, or not for this environment. */
  "unauthenticated",
  /** The action needs a sign-in within the last five minutes. Sign in again and retry. */
  "reauthentication_required",
  "invalid_request",
  /** The site does not exist or the caller is not its owner. */
  "not_found",
  "method_not_allowed",
  /** This generation (device and epoch) is already linked to another site. */
  "generation_linked",
  /** This site already holds a newer epoch of this device; the request names a generation from before a factory reset. */
  "stale_epoch",
  /** WorkOS could not be reached or refused the request. The message says what, if anything, changed. Retry later. */
  "provider_unavailable",
  "internal",
] as const;

export const errorCodeSchema = z.enum(errorCodes);

export const errorResponseSchema = z.strictObject({
  error: z.strictObject({ code: errorCodeSchema, message: z.string() }),
});

export type Role = z.infer<typeof roleSchema>;
export type CreateSiteRequest = z.infer<typeof createSiteRequestSchema>;
export type LinkControllerRequest = z.infer<typeof linkControllerRequestSchema>;
export type Controller = z.infer<typeof controllerSchema>;
export type Site = z.infer<typeof siteSchema>;
export type ListSitesResponse = z.infer<typeof listSitesResponseSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
