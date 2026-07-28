import { z } from 'zod';

/**
 * Runtime validation of API responses (acceptance criteria: "Zod validation
 * of responses"). Types come from the generated schema; these shapes must
 * stay in lockstep with it — `http.ts` parses every response through the
 * matching schema before returning data to callers, so a backend contract
 * break fails fast at the network boundary instead of surfacing as an
 * undefined deep in a view.
 */

export const moduleSchema = z.enum([
  'members',
  'applications',
  'loan_book',
  'transactions',
  'reports',
  'settings',
  'access_control',
]);
export type ModuleName = z.infer<typeof moduleSchema>;

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

export const statusOutSchema = z.object({ status: z.string() });

export const modulePermissionsOutSchema = z.object({
  module: z.string(),
  can_view: z.boolean(),
  can_create: z.boolean(),
  can_edit: z.boolean(),
  can_approve: z.boolean(),
});

export const myPermissionsResponseSchema = z.object({
  role_id: z.string(),
  permissions: z.array(modulePermissionsOutSchema),
});
export type MyPermissionsResponse = z.infer<typeof myPermissionsResponseSchema>;

export const roleOutSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_system: z.boolean(),
});
export type RoleOut = z.infer<typeof roleOutSchema>;

export const permissionOutSchema = z.object({
  module: z.string(),
  can_view: z.boolean(),
  can_create: z.boolean(),
  can_edit: z.boolean(),
  can_approve: z.boolean(),
});
export type PermissionOut = z.infer<typeof permissionOutSchema>;

export const userOutSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  email: z.string(),
  branch: z.string().nullable(),
  role_name: z.string(),
  status: z.string(),
  last_active: z.string().nullable(),
});
export type UserOut = z.infer<typeof userOutSchema>;

export const rolesListSchema = z.array(roleOutSchema);
export const permissionsListSchema = z.array(permissionOutSchema);
export const usersListSchema = z.array(userOutSchema);
