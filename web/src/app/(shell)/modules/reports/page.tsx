import { RequireModule } from "@/modules/authz/components/RequireModule";
import { ReportsScreen } from "@/modules/reports/components/ReportsScreen";

/**
 * Reports module route (P15 module 8). Static segment takes precedence
 * over the scaffold's [moduleId] placeholder. Deny-by-default guard
 * from /me/permissions; the API enforces every call regardless
 * (gate 1.6).
 */
export default function ReportsPage() {
    return (
        <RequireModule module="reports">
            <ReportsScreen />
        </RequireModule>
    );
}
