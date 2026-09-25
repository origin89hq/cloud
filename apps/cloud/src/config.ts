import { z } from "zod";

/**
 * WorkOS settings for one environment. Staging Workers accept only the staging client ID and
 * production Workers only the production one: the JWKS is per client, and the issuer and
 * audience are checked on every token.
 */
export interface WorkosConfig {
  clientId: string;
  issuer: string;
  audience: string;
  apiKey: string;
}

const schema = z.object({
  WORKOS_CLIENT_ID: z.string().regex(/^client_[0-9A-Z]{26}$/),
  WORKOS_ISSUER: z.url({ protocol: /^https$/ }),
  WORKOS_AUDIENCE: z.string().min(1),
  WORKOS_API_KEY: z.string().startsWith("sk_"),
});

/** Reads the environment, or `null` when any value is missing or malformed. */
export function workosConfig(env: unknown): WorkosConfig | null {
  const parsed = schema.safeParse(env);
  if (!parsed.success) return null;
  return {
    clientId: parsed.data.WORKOS_CLIENT_ID,
    issuer: parsed.data.WORKOS_ISSUER,
    audience: parsed.data.WORKOS_AUDIENCE,
    apiKey: parsed.data.WORKOS_API_KEY,
  };
}
