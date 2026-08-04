import { RequireModule } from "@/modules/authz/components/RequireModule";
import { TransactionsScreen } from "@/modules/transactions/components/TransactionsScreen";

/**
 * Transactions module route (P15 module 6). Static segment takes
 * precedence over the scaffold's [moduleId] placeholder. Deny-by-default
 * guard from /me/permissions; the API enforces every call regardless
 * (gate 1.6).
 */
export default function TransactionsPage() {
    return (
        <RequireModule module="transactions">
            <TransactionsScreen />
        </RequireModule>
    );
}
