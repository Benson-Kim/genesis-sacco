import { RequireModule } from "@/modules/authz/components/RequireModule";
import { PeriodContextNote } from "@/modules/periods/components/PeriodContextNote";
import { ReportsScreen } from "@/modules/reports/components/ReportsScreen";

/**
 * Reports module route (P15 module 8). Static segment takes precedence
 * over the scaffold's [moduleId] placeholder. Deny-by-default guard
 * from /me/permissions; the API enforces every call regardless
 * (gate 1.6).
 *
 * The period-context note (issue #31 batch 4 — audit #30 A5:
 * "statement readers have no period context") sits ABOVE the report
 * pickers. It SELF-GATES on transactions:view — a reports-only role
 * sees nothing and no periods endpoint is ever probed for it.
 */
export default function ReportsPage() {
    return (
        <RequireModule module="reports">
            <PeriodContextNote />
            <ReportsScreen />
        </RequireModule>
    );
}
