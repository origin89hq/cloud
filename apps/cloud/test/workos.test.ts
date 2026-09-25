import { describe, expect, it } from "vitest";
import { workosApi } from "../src/workos.ts";

const now = new Date("2026-09-25T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function recording(respond: () => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return respond();
  }) as typeof fetch;
  return { requests, api: workosApi("sk_test_key", fetcher, () => now) };
}

const sessions =
  (...data: unknown[]) =>
  () =>
    Response.json({ data, list_metadata: {} });
const session = (overrides: Record<string, unknown> = {}) => ({
  id: "session_1",
  user_id: "user_1",
  status: "active",
  created_at: minutesAgo(2),
  impersonator: null,
  ...overrides,
});

describe("WorkOS session check", () => {
  it("is fresh for an active session begun within the window", async () => {
    const { api, requests } = recording(sessions(session({ id: "session_0" }), session()));
    expect(await api.checkSession("user_1", "session_1", 300)).toEqual({ kind: "fresh" });
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/user_management/users/user_1/sessions");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer sk_test_key");
  });

  it("is fresh at exactly the window and stale just past it", async () => {
    expect(
      await recording(sessions(session({ created_at: minutesAgo(5) }))).api.checkSession(
        "user_1",
        "session_1",
        300,
      ),
    ).toEqual({ kind: "fresh" });
    expect(
      await recording(
        sessions(session({ created_at: new Date(now.getTime() - 300_001).toISOString() })),
      ).api.checkSession("user_1", "session_1", 300),
    ).toEqual({ kind: "stale" });
  });

  it("is stale for an ended, impersonated or unlisted session", async () => {
    for (const listed of [
      session({ status: "inactive" }),
      session({ impersonator: { email: "support@workos.test", reason: null } }),
      session({ id: "session_other" }),
    ]) {
      expect(
        await recording(sessions(listed)).api.checkSession("user_1", "session_1", 300),
      ).toEqual({ kind: "stale" });
    }
  });

  it("is unavailable when WorkOS errors, times out or answers something unexpected", async () => {
    for (const respond of [
      () => new Response("", { status: 500 }),
      () => new Response("", { status: 404 }),
      () => new Response("not json"),
      () => Response.json({ sessions: [] }),
      () => {
        throw new TypeError("network down");
      },
    ]) {
      expect(await recording(respond).api.checkSession("user_1", "session_1", 300)).toEqual({
        kind: "unavailable",
      });
    }
  });
});

describe("WorkOS user deletion", () => {
  it("deletes the user with the API key", async () => {
    const { api, requests } = recording(() => new Response(null, { status: 202 }));
    expect(await api.deleteUser("user_1")).toEqual({ kind: "deleted" });
    expect(requests[0]?.method).toBe("DELETE");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/user_management/users/user_1");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer sk_test_key");
  });

  it("treats an already deleted user as deleted", async () => {
    const { api } = recording(() => new Response("", { status: 404 }));
    expect(await api.deleteUser("user_1")).toEqual({ kind: "deleted" });
  });

  it("is unavailable when WorkOS refuses or cannot be reached", async () => {
    for (const respond of [
      () => new Response("", { status: 401 }),
      () => new Response("", { status: 500 }),
      () => {
        throw new TypeError("network down");
      },
    ]) {
      expect(await recording(respond).api.deleteUser("user_1")).toEqual({ kind: "unavailable" });
    }
  });

  it("escapes the user ID into the path", async () => {
    const { api, requests } = recording(() => new Response(null, { status: 200 }));
    await api.deleteUser("user_1/../sessions");
    expect(new URL(requests[0]?.url ?? "").pathname).toBe(
      "/user_management/users/user_1%2F..%2Fsessions",
    );
  });
});
