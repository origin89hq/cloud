import {
  apiPrefix,
  createSiteRequestSchema,
  type ListSitesResponse,
  linkControllerRequestSchema,
} from "@origin89/cloud";
import { z } from "zod";
import { type AccessClaims, bearerToken, type TokenVerifier } from "./auth.ts";
import { failure, json, jsonBody } from "./http.ts";
import type { Store } from "./store.ts";
import type { Workos } from "./workos.ts";

export interface Services {
  store: Store;
  verifier: TokenVerifier;
  workos: Workos;
}

/** How recently the person must have signed in to link a controller or delete the account. */
export const freshSignInSeconds = 300;
const bodyLimit = 4_096;
const siteIdSchema = z.uuid();

type Route =
  | { kind: "sites" }
  | { kind: "site_controllers"; siteId: string }
  | { kind: "account" }
  | { kind: "unknown" };

function route(pathname: string): Route {
  if (pathname === `${apiPrefix}/sites`) return { kind: "sites" };
  if (pathname === `${apiPrefix}/account`) return { kind: "account" };
  const match = new RegExp(`^${apiPrefix}/sites/([^/]+)/controllers$`).exec(pathname);
  const siteId = siteIdSchema.safeParse(match?.[1]);
  if (siteId.success) return { kind: "site_controllers", siteId: siteId.data };
  return { kind: "unknown" };
}

const notFound = () => failure(404, "not_found", "Not found.");
const methodNotAllowed = (allow: string) =>
  failure(405, "method_not_allowed", "Method not allowed.", { allow });
const invalid = (issues: z.core.$ZodIssue[]) =>
  failure(
    400,
    "invalid_request",
    issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "),
  );
const unavailable = () =>
  failure(503, "provider_unavailable", "Sign-in service unavailable. Try again shortly.");

type Authenticated = { ok: true; claims: AccessClaims } | { ok: false; response: Response };

async function authenticate(request: Request, verifier: TokenVerifier): Promise<Authenticated> {
  const token = bearerToken(request);
  const verification = token
    ? await verifier.verify(token)
    : ({ ok: false, reason: "invalid" } as const);
  if (verification.ok) return verification;
  if (verification.reason === "unavailable") return { ok: false, response: unavailable() };
  return {
    ok: false,
    response: failure(401, "unauthenticated", "Sign in to continue.", {
      "www-authenticate": 'Bearer error="invalid_token"',
    }),
  };
}

/** `null` when the session began with a sign-in within the window; otherwise the response. */
async function requireFreshSignIn(claims: AccessClaims, workos: Workos): Promise<Response | null> {
  const check = await workos.checkSession(claims.subject, claims.sessionId, freshSignInSeconds);
  if (check.kind === "fresh") return null;
  if (check.kind === "unavailable") return unavailable();
  // RFC 9470 step-up: the client signs in again and retries.
  return failure(401, "reauthentication_required", "Sign in again to continue.", {
    "www-authenticate": `Bearer error="insufficient_user_authentication", max_age=${freshSignInSeconds}`,
  });
}

export async function handle(request: Request, services: Services): Promise<Response> {
  const target = route(new URL(request.url).pathname);
  switch (target.kind) {
    case "unknown":
      return notFound();
    case "sites": {
      if (request.method !== "GET" && request.method !== "POST")
        return methodNotAllowed("GET, POST");
      const auth = await authenticate(request, services.verifier);
      if (!auth.ok) return auth.response;
      if (request.method === "GET") {
        const user = await services.store.findUser(auth.claims);
        const body: ListSitesResponse = { sites: user ? await services.store.listSites(user) : [] };
        return json(body);
      }
      const body = await jsonBody(request, bodyLimit);
      if (!body.ok) return body.response;
      const parsed = createSiteRequestSchema.safeParse(body.value);
      if (!parsed.success) return invalid(parsed.error.issues);
      const user = await services.store.resolveUser(auth.claims);
      return json(await services.store.createSite(user, parsed.data.name), 201);
    }
    case "site_controllers": {
      if (request.method !== "POST") return methodNotAllowed("POST");
      const auth = await authenticate(request, services.verifier);
      if (!auth.ok) return auth.response;
      const body = await jsonBody(request, bodyLimit);
      if (!body.ok) return body.response;
      const parsed = linkControllerRequestSchema.safeParse(body.value);
      if (!parsed.success) return invalid(parsed.error.issues);
      const user = await services.store.findUser(auth.claims);
      if (!user) return notFound();
      const stale = await requireFreshSignIn(auth.claims, services.workos);
      if (stale) return stale;
      const outcome = await services.store.linkController(user, target.siteId, parsed.data);
      switch (outcome.kind) {
        case "linked":
          return json(outcome.controller, 201);
        case "already_linked":
          return json(outcome.controller, 200);
        case "not_found":
          return notFound();
        case "generation_linked":
          return failure(
            409,
            "generation_linked",
            "This controller is already linked to another site. A factory reset starts a new generation that can be linked.",
          );
        case "stale_epoch":
          return failure(
            409,
            "stale_epoch",
            "A newer epoch of this controller is already linked to this site. Reconnect to the controller and retry.",
          );
      }
      break;
    }
    case "account": {
      if (request.method !== "DELETE") return methodNotAllowed("DELETE");
      const auth = await authenticate(request, services.verifier);
      if (!auth.ok) return auth.response;
      const stale = await requireFreshSignIn(auth.claims, services.workos);
      if (stale) return stale;
      // Local data goes first, so a WorkOS failure leaves a retry that can still pass the
      // fresh sign-in check. After WorkOS confirms, delete again: a concurrent request with
      // the same token may have recreated an empty user in between.
      const removeLocal = async () => {
        const user = await services.store.findUser(auth.claims);
        if (user) await services.store.deleteUser(user);
      };
      await removeLocal();
      const deleted = await services.workos.deleteUser(auth.claims.subject);
      if (deleted.kind === "unavailable")
        return failure(
          502,
          "provider_unavailable",
          "Your sites and memberships were deleted, but the sign-in account was not. Retry to finish.",
        );
      await removeLocal();
      return new Response(null, { status: 204 });
    }
  }
  return notFound();
}
