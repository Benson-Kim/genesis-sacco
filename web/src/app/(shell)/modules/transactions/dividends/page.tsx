import { RequireModule } from "@/modules/authz/components/RequireModule";
import { DividendsScreen } from "@/modules/dividends/components/DividendsScreen";

/**
 * Dividends lifecycle route (issue #31 batch 2 — the P13.11
 * declare/approve/distribute contract). Lives under the transactions
 * RBAC module: every /dividends route is gated on transactions
 * view/edit/approve server-side (there is no dedicated dividends
 * module in the P4 matrix). Deny-by-default guard from
 * /me/permissions; the API enforces every call regardless (gate 1.6).
 */
export default function DividendsPage() {
    return (
        <RequireModule module="transactions">
            <DividendsScreen />
        </RequireModule>
    );
}
