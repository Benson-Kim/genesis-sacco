/**
 * Per-tab dividend-declarer registry (issue #31 batch 2 — separation
 * of duties, UX side; the exits/applications makerRegistry precedent).
 *
 * WHY THIS IS THE ONLY WITNESS HERE (contract honesty): the DB
 * carries dividend_declarations.requested_by (migration 0020) and the
 * server enforces it — the declarer can neither VOTE on nor
 * DISTRIBUTE their own declaration (403, application/dividends.py) —
 * but DeclarationOut does NOT expose the field, so unlike the exits
 * and applications modules after !66/!71 there is NO server
 * attribution for this client to prefer. That read-contract gap is
 * recorded on issue #31 as a contract follow-up (the !66 R3/R4
 * pattern: expose the bare UUID under least disclosure); it is NEVER
 * faked client-side. Until it lands, this per-tab registry is the
 * sole maker witness feeding MakerCheckerPanel.
 *
 * Scope and honesty: the registry is per-tab and in-memory — it cannot
 * know a declaration made by another operator or in another tab, and
 * for those the maker is UNKNOWN (a distinct sentinel that never
 * equals a real user id, so MakerCheckerPanel's self-check simply
 * cannot match). The ENFORCED invariants are server-side regardless
 * (gate 1.6): both self-acts 403 on the persisted requested_by, and
 * the decision needs the configured quorum (the P9 machinery).
 */
import { registerSessionScopedStore } from "@/modules/auth/sessionScopedStores";

const makers = new Map<string, string>();

/** Sentinel for "maker not witnessed by this tab" — never a valid UUID. */
export const DIVIDEND_MAKER_UNKNOWN = "dividend-maker-unknown";

/** Record that `userId` declared dividend `declarationId`. */
export function recordDividendMaker(declarationId: string, userId: string): void {
  makers.set(declarationId, userId);
}

/** The maker this tab witnessed, or the UNKNOWN sentinel. */
export function dividendMakerOf(declarationId: string): string {
  return makers.get(declarationId) ?? DIVIDEND_MAKER_UNKNOWN;
}

/** Session-teardown hygiene (W58-2, the !60 F2 class): registered as a
 * session-scoped store below, so BOTH teardown paths — the query-path
 * 401 dual-cache teardown and explicit sign-out — clear it. A prior
 * operator's declarations never feed the next session's
 * MakerCheckerPanel SoD decision. Also test hygiene. */
export function clearDividendMakers(): void {
  makers.clear();
}

// Teardown wiring by construction (W58-2): registration at module scope
// means the registry cannot exist without dying on session teardown.
registerSessionScopedStore(clearDividendMakers);
