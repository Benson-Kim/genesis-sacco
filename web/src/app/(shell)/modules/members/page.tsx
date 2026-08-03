import { RequireModule } from "@/modules/authz/components/RequireModule";
import { MembersScreen } from "@/modules/members/components/MembersScreen";

/**
 * Members module route (P15). Static segment takes precedence over the
 * scaffold's [moduleId] placeholder. Deny-by-default guard from
 * /me/permissions; the API enforces every call regardless (gate 1.6).
 */
export default function MembersPage() {
    return (
        <RequireModule module="members">
            <MembersScreen />
        </RequireModule>
    );
}

