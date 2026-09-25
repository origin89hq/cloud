import { env } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { handle, type Services } from "../src/app.ts";
import { tokenVerifier } from "../src/auth.ts";
import { Store } from "../src/store.ts";
import type { DeleteOutcome, SessionCheck, Workos } from "../src/workos.ts";

export const issuer = "https://auth.test.origin89.com";
export const audience = "https://cloud.test.origin89.com";

const signing = await generateKeyPair("RS256");
const stranger = await generateKeyPair("RS256");
export const jwks = createLocalJWKSet({
  keys: [{ ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "RS256", use: "sig" }],
});

export interface TokenOptions {
  claims?: JWTPayload;
  /** Seconds from now; negative for an expired token. */
  expiresIn?: number;
  kid?: string;
  /** Sign with a key the JWKS does not hold. */
  foreignKey?: boolean;
}

export async function token(subject: string, options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: `session_${subject}`, ...options.claims })
    .setProtectedHeader({ alg: "RS256", kid: options.kid ?? "k1" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt(now - 10)
    .setExpirationTime(now + (options.expiresIn ?? 300))
    .sign(options.foreignKey ? stranger.privateKey : signing.privateKey);
}

/** A WorkOS stand-in: every session is fresh unless told otherwise, and deletes are recorded. */
export class FakeWorkos implements Workos {
  session: SessionCheck = { kind: "fresh" };
  deletion: DeleteOutcome = { kind: "deleted" };
  readonly sessionChecks: { userId: string; sessionId: string; maxAgeSeconds: number }[] = [];
  readonly deleted: string[] = [];

  async checkSession(userId: string, sessionId: string, maxAgeSeconds: number) {
    this.sessionChecks.push({ userId, sessionId, maxAgeSeconds });
    return this.session;
  }

  async deleteUser(userId: string) {
    if (this.deletion.kind === "deleted") this.deleted.push(userId);
    return this.deletion;
  }
}

export function services(workos = new FakeWorkos()): Services & { workos: FakeWorkos } {
  return {
    store: new Store(env.DB),
    verifier: tokenVerifier(jwks, { issuer, audience }),
    workos,
  };
}

let counter = 0;
/** A WorkOS user ID no other test uses, so tests sharing the database stay independent. */
export function newSubject(): string {
  counter += 1;
  return `user_${crypto.randomUUID().replaceAll("-", "")}${counter}`;
}

export async function call(
  svc: Services,
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers();
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  return handle(new Request(`https://cloud.test.origin89.com${path}`, init), svc);
}

export const deviceId = () => crypto.randomUUID().replaceAll("-", "");

export async function count(table: string, where: string, ...values: unknown[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
