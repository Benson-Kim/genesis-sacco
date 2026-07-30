import type { Metadata } from "next";
import { RequireModule } from "@/modules/authz/components/RequireModule";
import { UsersScreen } from "@/modules/users/components/UsersScreen";

export const metadata: Metadata = {
  title: "Access control · Users · Genesis Prestige Admin",
};

/**
 * P13.5 — system users administration (prototype Access-control "Users"
 * tab). Route-guarded by /me/permissions; the API enforces every call
 * server-side regardless (gate 1.6).
 */
export default function AccessControlUsersPage() {
  return (
    <RequireModule module="access_control">
      <UsersScreen />
    </RequireModule>
  );
}
