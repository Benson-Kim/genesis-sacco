import type { ZodSchema } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly category: string,
    public readonly correlationId: string | undefined,
    public readonly status: number,
  ) {
    super(`API error (${category || String(status)}): ${correlationId ?? 'no correlation id'}`);
  }
}

/** 409 from optimistic locking (gate 1.4) — callers render an inline conflict banner. */
export class VersionConflictError extends ApiError {}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface HttpClientConfig {
  baseUrl: string;
  tenantId: string;
  getTokens: () => AuthTokens | null;
  /** Called after a successful silent refresh so the caller can persist the new pair. */
  onTokensRefreshed: (tokens: AuthTokens) => void;
  /** Called when refresh itself fails (refresh token expired/revoked) — caller should force re-login. */
  onSessionExpired: () => void;
}

let config: HttpClientConfig | null = null;

export function configureHttpClient(next: HttpClientConfig) {
  config = next;
}

function requireConfig(): HttpClientConfig {
  if (!config) throw new Error('http client not configured — call configureHttpClient() at app startup');
  return config;
}

let refreshInFlight: Promise<AuthTokens | null> | null = null;

async function refreshTokens(): Promise<AuthTokens | null> {
  const cfg = requireConfig();
  const tokens = cfg.getTokens();
  if (!tokens) return null;
  refreshInFlight ??= (async () => {
      const res = await fetch(`${cfg.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': cfg.tenantId },
        body: JSON.stringify({ refresh_token: tokens.refreshToken }),
      });
      if (!res.ok) {
        cfg.onSessionExpired();
        return null;
      }
      const body = (await res.json()) as { access_token: string; refresh_token: string };
      const next = { accessToken: body.access_token, refreshToken: body.refresh_token };
      cfg.onTokensRefreshed(next);
      return next;
    })().finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export interface RequestOptions<TBody> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: TBody;
  /** Required on every mutating call per gate 1.4 — pass a stable key (e.g. crypto.randomUUID()). */
  idempotencyKey?: string;
  /** Skip the Authorization header (pre-auth endpoints like /auth/otp/*). */
  unauthenticated?: boolean;
}

/**
 * Fetch wrapper used by every generated client function. Every response is
 * parsed through the caller-supplied Zod schema before it reaches app code
 * (acceptance criteria: "Zod validation of responses").
 */
export async function apiRequest<TResponse, TBody = unknown>(
  path: string,
  schema: ZodSchema<TResponse>,
  options: RequestOptions<TBody> = {},
): Promise<TResponse> {
  const cfg = requireConfig();
  const { method = 'GET', body, idempotencyKey, unauthenticated = false } = options;

  async function doFetch(): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-tenant-id': cfg.tenantId,
    };
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    if (!unauthenticated) {
      const tokens = cfg.getTokens();
      if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return fetch(`${cfg.baseUrl}${path}`, init);
  }

  let res = await doFetch();

  if (res.status === 401 && !unauthenticated) {
    const refreshed = await refreshTokens();
    if (refreshed) res = await doFetch();
  }

  if (!res.ok) {
    let category = '';
    let correlationId: string | undefined;
    try {
      const errBody = (await res.json()) as { category?: string; correlation_id?: string };
      category = errBody.category ?? '';
      correlationId = errBody.correlation_id;
    } catch {
      // Non-JSON error body — fall through with empty category.
    }
    const ErrorClass = res.status === 409 ? VersionConflictError : ApiError;
    throw new ErrorClass(category, correlationId, res.status);
  }

  if (res.status === 204) return undefined as TResponse;

  const json: unknown = await res.json();
  return schema.parse(json);
}