/**
 * Per-tab exit maker registry (P15 module 7 — separation of duties,
 * UX side; the applications makerRegistry precedent).
 *
 * WHY THIS EXISTS: the P12 contract does not expose who initiated an
 * exit request (ExitOut carries no requested_by — the initiator's
 * identity lives only in the server-side audit row, which is
 * access_control-gated). The MakerCheckerPanel needs a maker principal
 * id to structurally withhold checker affordances from the maker, so
 * this registry records the maker identity THIS TAB witnessed: when
 * the signed-in operator creates an exit request, their own user id is
 * recorded against the new exit record.
 *
 * Scope and honesty: the registry is per-tab and in-memory — it cannot
 * know a request initiated by another operator or in another tab, and
 * for those the maker is UNKNOWN (a distinct sentinel that never
 * equals a real user id, so MakerCheckerPanel's self-check simply
 * cannot match). The ENFORCED invariants are server-side regardless
 * (gate 1.6): the initiator can never vote on their own request and
 * can never post its money-moving settlement (both 403), and the
 * decision needs a two-voter quorum (the P9 machinery). Surfacing the
 * initiator in the contract is recorded as an honest gap in the MR.
 */
import { registerSessionScopedStore } from "@/modules/auth/sessionScopedStores";

const makers = new Map<string, string>();

/** Sentinel for "maker not witnessed by this tab" — never a valid UUID. */
export const EXIT_MAKER_UNKNOWN = "exit-maker-unknown";

/** Record that `userId` initiated exit request `exitId`. */
export function recordExitMaker(exitId: string, userId: string): void {
  makers.set(exitId, userId);
}

/** The maker this tab witnessed, or the UNKNOWN sentinel. */
export function exitMakerOf(exitId: string): string {
  return makers.get(exitId) ?? EXIT_MAKER_UNKNOWN;
}

/** Session-teardown hygiene (W58-2, the !60 F2 class): registered as a
 * session-scoped store below, so BOTH teardown paths — the query-path
 * 401 dual-cache teardown and explicit sign-out — clear it. A prior
 * operator's initiations never feed the next session's
 * MakerCheckerPanel SoD decision. Also test hygiene. */
export function clearExitMakers(): void {
  makers.clear();
}

// Teardown wiring by construction (W58-2): registration at module scope
// means the registry cannot exist without dying on session teardown.
registerSessionScopedStore(clearExitMakers);
