import { z } from 'zod';
import { apiRequest, configureHttpClient, ApiError, VersionConflictError } from './http';
import type { AuthTokens, HttpClientConfig } from './http';
import {
  tokenResponseSchema,
  statusOutSchema,
  myPermissionsResponseSchema,
  rolesListSchema,
  permissionsListSchema,
  permissionOutSchema,
  usersListSchema,
  type ModuleName,
  type MyPermissionsResponse,
  type RoleOut,
  type PermissionOut,
  type UserOut,
} from './schemas';

export { configureHttpClient, ApiError, VersionConflictError };
export type { AuthTokens, HttpClientConfig, MyPermissionsResponse, RoleOut, PermissionOut, UserOut, ModuleName };
export type { CursorPage } from './pagination-contract';

export const auth = {
  requestOtp: (email: string) =>
    apiRequest('/auth/otp/request', statusOutSchema, {
      method: 'POST',
      body: { email },
      unauthenticated: true,
    }),

  verifyOtp: (email: string, code: string) =>
    apiRequest('/auth/otp/verify', tokenResponseSchema, {
      method: 'POST',
      body: { email, code },
      unauthenticated: true,
    }),

  refresh: (refreshToken: string) =>
    apiRequest('/auth/refresh', tokenResponseSchema, {
      method: 'POST',
      body: { refresh_token: refreshToken },
      unauthenticated: true,
    }),

  logout: (refreshToken: string) =>
    apiRequest('/auth/logout', z.undefined(), {
      method: 'POST',
      body: { refresh_token: refreshToken },
      unauthenticated: true,
    }),
};

export const me = {
  getPermissions: () => apiRequest('/me/permissions', myPermissionsResponseSchema),
};

export const access = {
  listRoles: () => apiRequest('/access/roles', rolesListSchema),

  listUsers: () => apiRequest('/access/users', usersListSchema),

  getRolePermissions: (roleId: string) =>
    apiRequest(`/access/roles/${roleId}/permissions`, permissionsListSchema),

  updateRolePermission: (
    roleId: string,
    module: ModuleName,
    grant: { can_view: boolean; can_create: boolean; can_edit: boolean; can_approve: boolean },
    idempotencyKey: string,
  ) =>
    apiRequest(`/access/roles/${roleId}/permissions/${module}`, permissionOutSchema, {
      method: 'PUT',
      body: grant,
      idempotencyKey,
    }),
};

/**
 * Members, loan book, and ledger list endpoints (MASTER_PROMPT P8/P10/P11)
 * have not landed on the backend yet — only auth/me/access exist today (see
 * backend/src/genesis/api/). The keyset-pagination contract these must
 * satisfy is fixed now via `CursorPage<T>` (packages/api-client/src/
 * pagination-contract.ts) and packages/ui's `useCursorPagination` /
 * `CursorTable` already consume it, so wiring these three modules in is a
 * matter of adding a `fetchPage` per module + regenerating the client —
 * no table/pagination code to write at that point.
 */
