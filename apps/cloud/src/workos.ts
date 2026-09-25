import { z } from "zod";

export type SessionCheck =
  /** The session is active, not impersonated, and started within the window. */
  | { kind: "fresh" }
  /** The session is old, ended, impersonated, or not among the user's recent sessions. */
  | { kind: "stale" }
  | { kind: "unavailable" };

export type DeleteOutcome = { kind: "deleted" } | { kind: "unavailable" };

/** The WorkOS operations this service needs, using the secret API key. */
export interface Workos {
  /** Whether `sessionId` of `userId` began with a sign-in within the last `maxAgeSeconds`. */
  checkSession(userId: string, sessionId: string, maxAgeSeconds: number): Promise<SessionCheck>;
  /** Deletes the WorkOS user. An already deleted user counts as deleted. */
  deleteUser(userId: string): Promise<DeleteOutcome>;
}

const sessionList = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      created_at: z.iso.datetime({ offset: true }),
      impersonator: z.unknown().optional(),
    }),
  ),
});

// A session started within the window is among the newest; a user with more new sessions
// than this is asked to sign in again rather than paging through all of them.
const recentSessions = 10;
const requestTimeoutMs = 5_000;

export function workosApi(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): Workos {
  const base = "https://api.workos.com/user_management";
  const headers = { authorization: `Bearer ${apiKey}` };
  const send = async (path: string, init: RequestInit): Promise<Response | null> => {
    try {
      return await fetcher(`${base}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      return null;
    }
  };
  return {
    async checkSession(userId, sessionId, maxAgeSeconds) {
      const query = new URLSearchParams({ limit: String(recentSessions), order: "desc" });
      const response = await send(`/users/${encodeURIComponent(userId)}/sessions?${query}`, {
        method: "GET",
      });
      if (!response?.ok) return { kind: "unavailable" };
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { kind: "unavailable" };
      }
      const parsed = sessionList.safeParse(body);
      if (!parsed.success) return { kind: "unavailable" };
      const session = parsed.data.data.find((candidate) => candidate.id === sessionId);
      if (session?.status !== "active" || session.impersonator) return { kind: "stale" };
      const age = now().getTime() - Date.parse(session.created_at);
      return age <= maxAgeSeconds * 1000 ? { kind: "fresh" } : { kind: "stale" };
    },
    async deleteUser(userId) {
      const response = await send(`/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
      await response?.body?.cancel();
      if (response?.ok || response?.status === 404) return { kind: "deleted" };
      return { kind: "unavailable" };
    },
  };
}
