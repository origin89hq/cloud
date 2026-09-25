import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { WorkosConfig } from "./config.ts";

/** The claims this service relies on from a verified WorkOS access token. */
export interface AccessClaims {
  issuer: string;
  /** The WorkOS user ID. Only meaningful together with `issuer`. */
  subject: string;
  /** The WorkOS session ID, used to check how recently the person signed in. */
  sessionId: string;
}

export type Verification =
  | { ok: true; claims: AccessClaims }
  /** The token is not acceptable: malformed, expired, wrongly signed, or for another environment. */
  | { ok: false; reason: "invalid" }
  /** The JWKS could not be fetched, so the token could be neither accepted nor rejected. */
  | { ok: false; reason: "unavailable" };

export interface TokenVerifier {
  verify(token: string): Promise<Verification>;
}

/** WorkOS publishes each client's signing keys at `/sso/jwks/<clientId>`. */
export function workosJwks(clientId: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${clientId}`), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
  });
}

const maxTokenLength = 8_192;

export function tokenVerifier(
  keys: JWTVerifyGetKey,
  config: Pick<WorkosConfig, "issuer" | "clientId">,
  now: () => Date = () => new Date(),
): TokenVerifier {
  return {
    async verify(token) {
      if (token.length > maxTokenLength) return { ok: false, reason: "invalid" };
      try {
        const { payload } = await jwtVerify(token, keys, {
          algorithms: ["RS256"],
          issuer: config.issuer,
          requiredClaims: ["sub", "sid", "exp", "iat", "client_id"],
          currentDate: now(),
        });
        // AuthKit session tokens carry no `aud`; `client_id` names the application they were
        // issued to, so a token for any other client, in this environment or another, fails.
        if (
          payload.client_id !== config.clientId ||
          typeof payload.sid !== "string" ||
          !payload.sid ||
          !payload.sub ||
          !payload.iss
        )
          return { ok: false, reason: "invalid" };
        return {
          ok: true,
          claims: { issuer: payload.iss, subject: payload.sub, sessionId: payload.sid },
        };
      } catch (error) {
        // jose raises the generic JOSEError for a non-200 JWKS response, and fetch raises a
        // plain error when WorkOS is unreachable. Every other JOSE error is about the token.
        if (
          !(error instanceof errors.JOSEError) ||
          error.code === "ERR_JOSE_GENERIC" ||
          error instanceof errors.JWKSTimeout ||
          error instanceof errors.JWKSInvalid
        )
          return { ok: false, reason: "unavailable" };
        return { ok: false, reason: "invalid" };
      }
    },
  };
}

/** Extracts the token from `Authorization: Bearer <token>`, or `null`. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}
