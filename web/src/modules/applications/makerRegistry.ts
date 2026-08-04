/**
 * Per-tab committee maker registry (P15 module 3 — separation of duties,
 * UX side).
 *
 * WHY THIS EXISTS: the P9 contract does not expose who moved an
 * application into the committee stage (ApplicationOut carries no
 * created_by / recommended_by — the recommender's identity lives only in
 * the server-side audit row, which is access_control-gated). The
 * MakerCheckerPanel needs a maker principal id to structurally withhold
 * checker affordances from the maker, so this registry records the maker
 * identity THIS TAB witnessed: when the signed-in operator performs the
 * "recommend to committee" transition, their own user id is recorded
 * against the application.
 *
 * Scope and honesty: the registry is per-tab and in-memory — it cannot
 * know a recommendation made by another operator or in another tab, and
 * for those the maker is UNKNOWN (a distinct sentinel that never equals
 * a real user id, so MakerCheckerPanel's self-check simply cannot match).
 * The ENFORCED invariants are server-side regardless (gate 1.6): one
 * vote per voter (DB UNIQUE), voting open only in committee stage, and
 * approval-authority bands. Surfacing the recommender in the contract is
 * recorded as follow-up scope in the MR.
 */
import { registerSessionScopedStore } from "@/modules/auth/sessionScopedStores";

const makers = new Map<string, string>();

/** Sentinel for "maker not witnessed by this tab" — never a valid UUID. */
export const MAKER_UNKNOWN = "maker-unknown";

/** Record that `userId` moved `applicationId` into committee. */
export function recordCommitteeMaker(applicationId: string, userId: string): void {
  makers.set(applicationId, userId);
}

/** The maker this tab witnessed, or the UNKNOWN sentinel. */
export function committeeMakerOf(applicationId: string): string {
  return makers.get(applicationId) ?? MAKER_UNKNOWN;
}

/** Session-teardown hygiene (W58-2, the !60 F2 class): registered as a
 * session-scoped store below, so BOTH teardown paths — the query-path
 * 401 dual-cache teardown and explicit sign-out — clear it. A prior
 * operator's referral attributions never feed the next session's
 * MakerCheckerPanel SoD decision. Also test hygiene. */
export function clearCommitteeMakers(): void {
  makers.clear();
}

// Teardown wiring by construction (W58-2): registration at module scope
// means the registry cannot exist without dying on session teardown.
registerSessionScopedStore(clearCommitteeMakers);
