/**
 * Per-tab write-off requester registry (P15 batch 1 — separation of
 * duties, UX side; the exits makerRegistry precedent).
 *
 * WHY THIS MODULE NEEDS A REGISTRY AT ALL (the !70 rule: server truth
 * first, registry only as fallback): the 0025 loan_write_offs table
 * carries requested_by, but WriteOffOut deliberately does NOT
 * serialise it — the requester is NOT on this contract. Until that
 * contract follow-up lands (recorded on issue #31), this per-tab
 * witness is the ONLY maker signal available to MakerCheckerPanel for
 * the vote/post affordances. The ADJUSTMENT surface needs NO registry:
 * AdjustmentRecordOut.maker_id is required server truth (0025
 * NOT NULL) and is consumed directly.
 *
 * Scope and honesty: the registry is per-tab and in-memory — it cannot
 * know a request initiated by another operator or in another tab, and
 * for those the maker is UNKNOWN (a distinct sentinel that never
 * equals a real user id, so MakerCheckerPanel's self-check simply
 * cannot match). The ENFORCED invariants are server-side regardless
 * (gate 1.6): the requester can never vote on nor post their own
 * write-off (403, keyed on the persisted requested_by), and the
 * decision needs the committee quorum (the P9 machinery).
 */
import { registerSessionScopedStore } from "@/modules/auth/sessionScopedStores";

const makers = new Map<string, string>();

/** Sentinel for "maker not witnessed by this tab" — never a valid UUID. */
export const WRITE_OFF_MAKER_UNKNOWN = "write-off-maker-unknown";

/** Record that `userId` requested write-off `writeOffId`. */
export function recordWriteOffMaker(writeOffId: string, userId: string): void {
  makers.set(writeOffId, userId);
}

/** The maker this tab witnessed, or the UNKNOWN sentinel. */
export function writeOffMakerOf(writeOffId: string): string {
  return makers.get(writeOffId) ?? WRITE_OFF_MAKER_UNKNOWN;
}

/** Session-teardown hygiene (W58-2, the !60 F2 class): registered as a
 * session-scoped store below, so BOTH teardown paths — the query-path
 * 401 dual-cache teardown and explicit sign-out — clear it. A prior
 * operator's requests never feed the next session's MakerCheckerPanel
 * SoD decision. Also test hygiene. */
export function clearWriteOffMakers(): void {
  makers.clear();
}

// Teardown wiring by construction (W58-2): registration at module scope
// means the registry cannot exist without dying on session teardown.
registerSessionScopedStore(clearWriteOffMakers);
