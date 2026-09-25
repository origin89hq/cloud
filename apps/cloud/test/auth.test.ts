import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { bearerToken, tokenVerifier } from "../src/auth.ts";
import { call, clientId, issuer, jwks, newSubject, services, token } from "./helpers.ts";

const verifier = tokenVerifier(jwks, { issuer, clientId });

describe("access token verification", () => {
  it("accepts a WorkOS token and keeps issuer, subject and session", async () => {
    const subject = newSubject();
    expect(await verifier.verify(await token(subject))).toEqual({
      ok: true,
      claims: { issuer, subject, sessionId: `session_${subject}` },
    });
  });

  it("rejects an expired token", async () => {
    const result = await verifier.verify(await token(newSubject(), { expiresIn: -1 }));
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a token from another issuer", async () => {
    const other = tokenVerifier(jwks, { issuer: "https://api.workos.com/", clientId });
    expect(await other.verify(await token(newSubject()))).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a token issued to another client, such as the other environment's app", async () => {
    const other = tokenVerifier(jwks, { issuer, clientId: "client_01OTHEROTHEROTHEROTHEROTHE" });
    expect(await other.verify(await token(newSubject()))).toEqual({ ok: false, reason: "invalid" });
    const noClient = await token(newSubject(), { claims: { client_id: undefined } });
    expect(await verifier.verify(noClient)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a token signed with an unknown key", async () => {
    for (const options of [{ kid: "k2", foreignKey: true }, { foreignKey: true }]) {
      expect(await verifier.verify(await token(newSubject(), options))).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("rejects a symmetric token and one without a session", async () => {
    const hs = await new SignJWT({ sid: "s", client_id: clientId })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setIssuer(issuer)
      .setSubject(newSubject())
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode("a shared secret of thirty-two bytes"));
    expect(await verifier.verify(hs)).toEqual({ ok: false, reason: "invalid" });
    const noSession = await token(newSubject(), { claims: { sid: undefined } });
    expect(await verifier.verify(noSession)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects garbage and oversized tokens without fetching keys", async () => {
    expect(await verifier.verify("not.a.jwt")).toEqual({ ok: false, reason: "invalid" });
    expect(await verifier.verify("a".repeat(8_193))).toEqual({ ok: false, reason: "invalid" });
  });

  it("reports unavailable, not invalid, when the JWKS cannot be fetched", async () => {
    const offline = tokenVerifier(
      async () => {
        throw new TypeError("fetch failed");
      },
      { issuer, clientId },
    );
    expect(await offline.verify(await token(newSubject()))).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("bearer header", () => {
  const request = (authorization?: string) =>
    new Request("https://cloud.test", authorization ? { headers: { authorization } } : {});

  it("reads the token from a Bearer header in any case", () => {
    expect(bearerToken(request("Bearer a.b.c"))).toBe("a.b.c");
    expect(bearerToken(request("bearer a.b.c"))).toBe("a.b.c");
  });

  it("returns null for a missing, empty or non-Bearer header", () => {
    expect(bearerToken(request())).toBeNull();
    expect(bearerToken(request("Bearer "))).toBeNull();
    expect(bearerToken(request("Basic dXNlcjpwYXNz"))).toBeNull();
    expect(bearerToken(request("Bearer a b"))).toBeNull();
  });
});

describe("authenticated routes", () => {
  it("answer 401 with a Bearer challenge when the token is missing or invalid", async () => {
    const svc = services();
    for (const bearer of [undefined, await token(newSubject(), { expiresIn: -1 })]) {
      const response = await call(svc, "GET", "/v1/sites", bearer ? { token: bearer } : {});
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
      expect(await response.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }
  });

  it("answer 503 when keys cannot be fetched, rather than signing the person out", async () => {
    const svc = {
      ...services(),
      verifier: tokenVerifier(
        async () => {
          throw new TypeError("fetch failed");
        },
        { issuer, clientId },
      ),
    };
    const response = await call(svc, "GET", "/v1/sites", { token: await token(newSubject()) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "provider_unavailable" } });
  });
});
