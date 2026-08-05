import { RequireModule } from "@/modules/authz/components/RequireModule";
import { CorrectionsScreen } from "@/modules/corrections/components/CorrectionsScreen";

/**
 * Corrections module route (P15 follow-on batch 1, issue #31 — the
 * P13.15 corrections/write-offs/recoveries console, audit #30 finding
 * R1). Static segment takes precedence over the scaffold's [moduleId]
 * placeholder. Gated on the DEDICATED corrections RBAC module (never
 * generic transactions — the fraud channel carries its own permission
 * strings, A3). Deny-by-default guard from /me/permissions; the API
 * enforces every call regardless (gate 1.6).
 */
export default function CorrectionsPage() {
    return (
        <RequireModule module="corrections">
            <CorrectionsScreen />
        </RequireModule>
    );
}
