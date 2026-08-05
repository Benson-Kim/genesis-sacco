import { RequireModule } from "@/modules/authz/components/RequireModule";
import { RecoveryScreen } from "@/modules/recovery/components/RecoveryScreen";

/**
 * Recovery worklist route (P15 follow-on batch 1, issue #31 — the
 * P13.16 collections & recovery worklist, audit #30 finding R1).
 * Lives under the loan_book RBAC module: every /recovery-cases route
 * is gated on loan_book view/create/edit server-side (there is no
 * dedicated recovery module in the P4 matrix — the member-exit-under-
 * members precedent). Deny-by-default guard from /me/permissions; the
 * API enforces every call regardless (gate 1.6).
 */
export default function RecoveryPage() {
    return (
        <RequireModule module="loan_book">
            <RecoveryScreen />
        </RequireModule>
    );
}
