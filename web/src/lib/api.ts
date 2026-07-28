import { createGenesisClient } from "@genesis/api-client";
import { getValidAccessToken } from "@/modules/auth/session";
import { env } from "@/lib/env";

/**
 * The single authenticated API client for the app. All server state flows
 * through TanStack Query hooks that call this client — no ad-hoc fetch
 * (MASTER_PROMPT §2.3).
 */
export const api = createGenesisClient({
  baseUrl: env.apiBaseUrl,
  tenantId: env.tenantId,
  getAccessToken: getValidAccessToken,
});
