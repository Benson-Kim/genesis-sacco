import { RequireModule } from "@/modules/authz/components/RequireModule";
import { GuarantorsScreen } from "@/modules/guarantors/components/GuarantorsScreen";

/**
 * Guarantors route (P15 module 5 — prototype Operations ▸ Guarantors).
 * Guarded by the applications module grant (deny by default): every
 * guarantee endpoint (pledge/consent/release/substitute) is gated on
 * the applications module server-side (P9/P13.14), and the P13.9
 * guarantor aggregates slice is granted with applications:view. Pledge
 * and lifecycle affordances additionally require applications:edit.
 * The API enforces every call regardless (gate 1.6).
 */
export default function GuarantorsPage() {
    return (
        <RequireModule module="applications">
            <GuarantorsScreen />
        </RequireModule>
    );
}
