import type { JWTVerifyGetKey } from "jose";
import { handle } from "./app.ts";
import { tokenVerifier, workosJwks } from "./auth.ts";
import { workosConfig } from "./config.ts";
import { failure } from "./http.ts";
import { Store } from "./store.ts";
import { workosApi } from "./workos.ts";

// One JWKS cache per isolate, so keys are fetched once rather than on every request.
let jwks: { clientId: string; keys: JWTVerifyGetKey } | undefined;

export default {
  async fetch(request, env): Promise<Response> {
    const config = workosConfig(env);
    if (!config) {
      console.error({ event: "config_invalid" });
      return failure(500, "internal", "The service is not configured.");
    }
    if (jwks?.clientId !== config.clientId)
      jwks = { clientId: config.clientId, keys: workosJwks(config.clientId) };
    try {
      return await handle(request, {
        store: new Store(env.DB),
        verifier: tokenVerifier(jwks.keys, config),
        workos: workosApi(config.apiKey),
      });
    } catch (error) {
      // Never log the request: it carries a bearer token.
      console.error({
        event: "request_failed",
        error: error instanceof Error ? error.name : "unknown",
      });
      return failure(500, "internal", "Something went wrong.");
    }
  },
} satisfies ExportedHandler<Env>;
