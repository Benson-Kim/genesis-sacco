import { RequireModule } from "@/modules/authz/components/RequireModule";
import { LoansScreen } from "@/modules/loans/components/LoansScreen";

/**
 * Loan-book module route (P15 module 4). Static segment takes
 * precedence over the scaffold's [moduleId] placeholder. Deny-by-default
 * guard from /me/permissions; the API enforces every call regardless
 * (gate 1.6).
 */
export default function LoanBookPage() {
    return (
        <RequireModule module="loan_book">
            <LoansScreen />
        </RequireModule>
    );
}
