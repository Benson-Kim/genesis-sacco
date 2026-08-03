import { DashboardScreen } from "@/modules/dashboard/components/DashboardScreen";

/**
 * Dashboard — live figures from GET /dashboard/summary (P15). Every
 * amount is the API's decimal string; the client computes nothing
 * (P15 blocker (a)). Slices the caller's role is not granted arrive
 * omitted and render as "—" (deny-by-default, gate 1.6).
 */
export default function DashboardPage() {
    return <DashboardScreen />;
}
