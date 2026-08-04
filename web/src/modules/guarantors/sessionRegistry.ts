/**
 * Per-tab witnessed-guarantee registry (P15 module 5 — honesty side).
 *
 * WHY THIS EXISTS: the P9/P13.14 contract exposes NO guarantee
 * list/read endpoint — GuaranteeOut exists ONLY as the response of the
 * four writes (pledge, consent, release, substitute). The screen's
 * follow-up actions (consent a pledge, release, substitute) need the
 * guarantee id + version, and the only place this client can honestly
 * obtain them is a write response THIS TAB witnessed. The registry
 * records those records verbatim (id, parties, decimal-string amount,
 * status, version) so the operator can carry a pledge through consent
 * and release within their session.
 *
 * Scope and honesty (the makerRegistry precedent, !58): the registry is
 * per-tab and in-memory — it cannot see guarantees pledged by another
 * operator, in another tab, or before this page load; those records are
 * reachable only through the backend audit trail until a list endpoint
 * ships (recorded as follow-up scope in the MR). The ENFORCED
 * invariants are server-side regardless (gate 1.6): capacity under the
 * guarantor's deposit-account row lock, the status machine
 * (pledged -> active -> released), optimistic-lock versions and the
 * cover rule. Nothing here is a source of truth — every figure shown
 * from the registry is a SERVER response rendered verbatim.
 */
import { useSyncExternalStore } from "react";
import type { Guarantee } from "./schemas";

let records: readonly Guarantee[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Record (or update in place) a guarantee exactly as the server
 * returned it. Newest activity first; one row per guarantee id. */
export function recordWitnessedGuarantee(guarantee: Guarantee): void {
  records = [guarantee, ...records.filter((record) => record.id !== guarantee.id)];
  emit();
}

/** Test/sign-out hygiene. */
export function clearWitnessedGuarantees(): void {
  records = [];
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): readonly Guarantee[] {
  return records;
}

/** The guarantees this tab witnessed, newest activity first. */
export function useWitnessedGuarantees(): readonly Guarantee[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
