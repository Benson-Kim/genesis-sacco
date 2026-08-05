/**
 * Per-tab voted-write-off registry (W58-6 — honest "spent" vote
 * affordances; the exits/applications votedRegistry precedent).
 *
 * WHY THIS EXISTS: after a recorded write-off vote, component state
 * alone would re-arm the vote buttons when the drawer remounts (close
 * and reopen the record), steering the operator into a guaranteed 409
 * (the server's one-vote-per-voter UNIQUE makes replay harmless, but
 * the re-armed affordance is dishonest). This registry records the
 * write-off ids THIS TAB has voted on so the affordance stays spent
 * across remounts within the session.
 *
 * Scope and honesty: per-tab, in-memory — it cannot know votes cast by
 * another operator or in another tab; for those the server's 409
 * remains the enforcer (gate 1.6). Session-scoped per W58-2:
 * registered below, so both teardown paths clear it and the next
 * operator's tab never inherits a previous operator's spent votes.
 */
import { useSyncExternalStore } from "react";
import { registerSessionScopedStore } from "@/modules/auth/sessionScopedStores";

const voted = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Record that THIS TAB cast a vote on write-off `writeOffId`. */
export function recordVotedWriteOff(writeOffId: string): void {
  voted.add(writeOffId);
  emit();
}

/** Whether THIS TAB already voted on write-off `writeOffId`. */
export function hasVotedOnWriteOff(writeOffId: string): boolean {
  return voted.has(writeOffId);
}

/** Session-teardown hygiene (W58-2): registered as a session-scoped
 * store below. Also test hygiene. */
export function clearVotedWriteOffs(): void {
  voted.clear();
  emit();
}

// Teardown wiring by construction (W58-2): registration at module scope
// means the registry cannot exist without dying on session teardown.
registerSessionScopedStore(clearVotedWriteOffs);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reactive read for the detail drawer (re-renders on record/clear). */
export function useHasVotedOnWriteOff(writeOffId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => voted.has(writeOffId),
    () => false,
  );
}
