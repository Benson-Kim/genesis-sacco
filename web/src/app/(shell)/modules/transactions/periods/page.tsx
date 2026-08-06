import { RequireModule } from "@/modules/authz/components/RequireModule";
import { PeriodsScreen } from "@/modules/periods/components/PeriodsScreen";

/**
 * Accounting-periods route (issue #31 batch 4 — the P12.5 period
 * machinery; audit #30 finding A5). Lives under the transactions RBAC
 * module: every /accounting-periods route is gated on transactions
 * view/approve server-side (there is no dedicated periods module in
 * the P4 matrix — the dividends-under-transactions precedent).
 * Deny-by-default guard from /me/permissions; the API enforces every
 * call regardless (gate 1.6).
 */
export default function PeriodsPage() {
    return (
        <RequireModule module="transactions">
            <PeriodsScreen />
        </RequireModule>
    );
}
