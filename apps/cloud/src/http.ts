import type { ErrorCode, ErrorResponse } from "@origin89/cloud";

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

export function failure(
  status: number,
  code: ErrorCode,
  message: string,
  headers: HeadersInit = {},
): Response {
  const body: ErrorResponse = { error: { code, message } };
  return json(body, status, headers);
}

export type Body = { ok: true; value: unknown } | { ok: false; response: Response };

/** Reads a JSON body of at most `limit` bytes, whatever Content-Length claims. */
export async function jsonBody(request: Request, limit: number): Promise<Body> {
  const tooLarge = {
    ok: false,
    response: failure(413, "invalid_request", "The request body is too large."),
  } as const;
  if (Number(request.headers.get("content-length")) > limit) return tooLarge;
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true,
      value: JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)),
    };
  } catch {
    return {
      ok: false,
      response: failure(400, "invalid_request", "The request body is not valid JSON."),
    };
  }
}
