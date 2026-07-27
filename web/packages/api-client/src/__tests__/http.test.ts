import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { apiRequest, configureHttpClient, ApiError, VersionConflictError } from '../http';

const schema = z.object({ ok: z.boolean() });

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('apiRequest', () => {
  beforeEach(() => {
    configureHttpClient({
      baseUrl: 'https://api.test',
      tenantId: 'tenant-1',
      getTokens: () => ({ accessToken: 'access-1', refreshToken: 'refresh-1' }),
      onTokensRefreshed: vi.fn(),
      onSessionExpired: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses a successful response through the given zod schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));
    const result = await apiRequest('/thing', schema);
    expect(result).toEqual({ ok: true });
  });

  it('refreshes once and retries on a 401, then succeeds', async () => {
    const onTokensRefreshed = vi.fn();
    configureHttpClient({
      baseUrl: 'https://api.test',
      tenantId: 'tenant-1',
      getTokens: () => ({ accessToken: 'stale', refreshToken: 'refresh-1' }),
      onTokensRefreshed,
      onSessionExpired: vi.fn(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { category: 'unauthenticated', correlation_id: 'abc' }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'new', refresh_token: 'new-refresh', expires_in: 900 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await apiRequest('/thing', schema);
    expect(result).toEqual({ ok: true });
    expect(onTokensRefreshed).toHaveBeenCalledWith({ accessToken: 'new', refreshToken: 'new-refresh' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('throws VersionConflictError on 409 (optimistic-lock gate 1.4)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { category: 'conflict', correlation_id: 'xyz' })));
    await expect(apiRequest('/thing', schema, { method: 'PUT' })).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('throws a plain ApiError on other error statuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, { category: 'internal', correlation_id: 'zzz' })));
    await expect(apiRequest('/thing', schema)).rejects.toBeInstanceOf(ApiError);
  });
});
