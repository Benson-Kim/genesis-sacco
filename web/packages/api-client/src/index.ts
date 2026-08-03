/**
 * @genesis/api-client — typed client for the Genesis Prestige API.
 *
 * The request/response types in ./generated/schema.d.ts are GENERATED from
 * the backend OpenAPI contract (MASTER_PROMPT §2.1 — clients are generated,
 * never hand-written). Regenerate with `npm run generate:api`; CI enforces
 * freshness via the web:spec-drift and web:client-drift jobs.
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./generated/schema";

export type { paths, components } from "./generated/schema";
export { ApiError, errorEnvelopeSchema, toApiError } from "./errors";
export type { ErrorEnvelope } from "./errors";

export interface GenesisClientOptions {
  baseUrl: string;
  /** Tenant scope — sent as X-Tenant-Id (required pre-auth, harmless after). */
  tenantId?: string;
  /**
   * Returns a valid access token (may refresh first) or null when
   * unauthenticated. Async so callers can single-flight token refresh.
   */
  getAccessToken?: () => Promise<string | null>;
}

export type GenesisClient = ReturnType<typeof createClient<paths>>;

export function createGenesisClient(options: GenesisClientOptions): GenesisClient {
  const client = createClient<paths>({ baseUrl: options.baseUrl });

  const headersMiddleware: Middleware = {
    async onRequest({ request }) {
      if (options.tenantId) {
        request.headers.set("x-tenant-id", options.tenantId);
      }
      if (options.getAccessToken) {
        const token = await options.getAccessToken();
        if (token !== null) {
          request.headers.set("authorization", `Bearer ${token}`);
        }
      }
      return request;
    },
  };

  client.use(headersMiddleware);
  return client;
}

/**
 * Fresh Idempotency-Key for a logical mutation attempt (gate 1.4).
 * Generate ONE key per user intent (e.g. per form submission), reuse it on
 * retries of that same intent, and send it as the `Idempotency-Key` header.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
