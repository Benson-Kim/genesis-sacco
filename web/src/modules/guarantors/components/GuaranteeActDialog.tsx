"use client";

/**
 * Consent / release dialog for a guarantee THIS TAB witnessed (P15
 * module 5 — P9 consent, P13.14 release):
 *
 * - CONSENT (`POST /guarantees/{id}/consent`, applications:edit) records
 *   the guarantor's staff-attested consent: pledged -> active. The
 *   contract defines no maker-checker semantics here (the attestation
 *   trust model is the P9 consent route's own) — the guard is the typed
 *   confirmation + the server's status machine and optimistic lock.
 * - RELEASE (`POST /guarantees/{id}/release`) frees the pledge per the
 *   P13.14 rules. The UI offers it only where the contract can accept
 *   it: a pledged (unconsented) guarantee, or an active one still
 *   backing an UNDISBURSED application (the cover rule is re-verified
 *   server-side under the borrower's account lock). An active guarantee
 *   behind a disbursed loan is never bare-released — the substitution
 *   drawer is the only exit (the server 409s regardless).
 * - Both are versioned writes: EXACTLY ONE attempt per intent (typed
 *   phrase, pending short-circuit, retry: 0, stable/rotating
 *   Idempotency-Key). A 409 renders the shared ConflictBanner; the
 *   contract exposes NO per-guarantee read, so "reload" refetches the
 *   SERVER aggregates and structurally WITHDRAWS this record's
 *   affordances (per-tab conflict marking) — the stale act is never
 *   replayed and cannot be re-armed from a stale copy.
 */
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { idempotencyKeyFor, type IdempotencyKeySlot } from "@genesis/api-client";
import { Banner, Button, ConfirmDangerModal, Modal } from "@genesis/design-system";
import { ConflictBanner } from "@/modules/layout/ConflictBanner";
import { ErrorBanner } from "@/modules/layout/ErrorBanner";
import { announce } from "@/modules/layout/announcer";
import { isConflict } from "@/lib/errors";
import { fmtKes } from "@/lib/format";
import { STALE_TIME } from "@/lib/query";
import { fetchMember } from "@/modules/members/api";
import { consentGuarantee, releaseGuarantee } from "../api";
import { markWitnessedConflict, recordWitnessedGuarantee } from "../sessionRegistry";
import type { Guarantee } from "../schemas";
import { guaranteeStatusPill } from "./pills";
import styles from "./Guarantors.module.css";

export type GuaranteeAct = "consent" | "release";

const TITLES: Record<GuaranteeAct, string> = {
  consent: "Record guarantor consent",
  release: "Release guarantee",
};

function Kv({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className={styles.kvRow}>
      <span className={styles.kvKey}>{label}</span>
      <span className={styles.kvVal}>{children}</span>
    </div>
  );
}

function MemberKv({ label, memberId }: Readonly<{ label: string; memberId: string }>) {
  const member = useQuery({
    queryKey: ["members", "detail", memberId],
    queryFn: () => fetchMember(memberId),
    staleTime: STALE_TIME.record,
  });
  return (
    <Kv label={label}>
      {member.data !== undefined ? (
        <>
          {member.data.name} · {member.data.member_no}
        </>
      ) : (
        <span className={styles.mono}>{memberId}</span>
      )}
    </Kv>
  );
}

export function GuaranteeActDialog({
  guarantee,
  act,
  onClose,
}: Readonly<{
  guarantee: Guarantee;
  act: GuaranteeAct;
  onClose: () => void;
}>) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Guarantee | null>(null);
  const [withdrawn, setWithdrawn] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const keySlot = useRef<IdempotencyKeySlot>({ key: null, body: null });

  const mutation = useMutation({
    mutationFn: () => {
      const key = idempotencyKeyFor(
        keySlot.current,
        JSON.stringify({ op: `${act}-guarantee`, id: guarantee.id, version: guarantee.version }),
      );
      return act === "consent"
        ? consentGuarantee(guarantee.id, guarantee.version, key)
        : releaseGuarantee(guarantee.id, guarantee.version, key);
    },
    onSuccess: (updated) => {
      setConfirming(false);
      // SPENT affordance: the result panel replaces the action; the
      // registry carries the server's new status/version.
      setResult(updated);
      recordWitnessedGuarantee(updated);
      announce(act === "consent" ? "Guarantor consent recorded." : "Guarantee released.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "summary"] });
      void queryClient.invalidateQueries({ queryKey: ["applications", "list"] });
      if (guarantee.application_id !== null) {
        void queryClient.invalidateQueries({
          queryKey: ["applications", "detail", guarantee.application_id],
        });
      }
    },
    onError: () => {
      setConfirming(false);
      announce(
        act === "consent" ? "Consent was not recorded." : "The guarantee was not released.",
      );
    },
  });

  const conflict = mutation.isError && isConflict(mutation.error);

  // The UI offers only what the contract can accept (gate 1.6); the
  // server enforces the status machine regardless.
  const eligible =
    act === "consent"
      ? guarantee.status === "pledged"
      : guarantee.status === "pledged" ||
        (guarantee.status === "active" && guarantee.loan_id === null);
  const actionable = eligible && result === null && !withdrawn;

  function reloadAfterConflict() {
    // Explicit reload flow — with NO per-guarantee read in the contract,
    // reload refetches the server truth this screen CAN read (the P13.9
    // aggregates) and structurally withdraws this tab's stale copy; the
    // act is NEVER replayed (a fresh server response is required to
    // re-arm any affordance on this record).
    markWitnessedConflict(guarantee.id);
    setWithdrawn(true);
    void queryClient.refetchQueries({ queryKey: ["dashboard", "summary"] });
    mutation.reset();
    setNotice(
      "This guarantee changed outside this tab and its actions are withdrawn here — the contract exposes no per-guarantee read to refresh it.",
    );
    // Every async outcome is announced (issue #8): the withdrawal is an
    // outcome, not a success — the live region must say so (!60 F5).
    announce("Guarantee actions withdrawn — the record changed outside this tab.");
  }

  return (
    <Modal
      title={TITLES[act]}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      variant="dialog"
    >
      {/* Informational, NOT success styling: the notice reports a
          CONFLICTED/WITHDRAWN record (!60 F5). */}
      {notice !== "" && <Banner variant="info">{notice}</Banner>}
      <div className={styles.detailGrid}>
        <Kv label="Guarantee record">
          <span className={styles.mono}>{guarantee.id}</span>
        </Kv>
        <MemberKv label="Guarantor" memberId={guarantee.guarantor_member_id} />
        <MemberKv label="Borrower" memberId={guarantee.borrower_member_id} />
        <Kv label="Pledged amount">{fmtKes(guarantee.amount)}</Kv>
        <Kv label="Status">{guaranteeStatusPill(guarantee.status)}</Kv>
        <Kv label="Record version">{guarantee.version}</Kv>
      </div>

      {/* One copy of the 409 reload-and-re-enter flow (gate 1.1). */}
      <ConflictBanner error={mutation.error} onReload={reloadAfterConflict} />
      {mutation.isError && !conflict && <ErrorBanner error={mutation.error} />}

      {result !== null && (
        <div className={styles.resultPanel} role="status">
          <div className={styles.resultTitle}>
            {act === "consent" ? "Consent recorded" : "Guarantee released"}
          </div>
          <Kv label="Status">{guaranteeStatusPill(result.status)}</Kv>
          <Kv label="Record version">{result.version}</Kv>
          <div className={styles.formNote}>
            The status above is the server&apos;s word — nothing was advanced locally.
          </div>
        </div>
      )}

      {actionable && (
        <div className={styles.actions}>
          <Button type="button" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          {/* Both acts get the danger treatment: consent converts the
              pledge into ACTIVE collateral (money-adjacent), the same
              severity class as pledge/release (review !60 F7). */}
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              if (mutation.isPending) return;
              setConfirming(true);
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? "Working…"
              : act === "consent"
                ? "Record consent…"
                : "Release…"}
          </Button>
        </div>
      )}
      {!actionable && result === null && !withdrawn && (
        <div className={styles.formNote}>
          {act === "consent"
            ? "Only a pledged (unconsented) guarantee can be consented — this action is not offered."
            : "An active guarantee behind a disbursed loan can only be substituted, never released — this action is not offered (the server enforces this regardless)."}
        </div>
      )}

      {confirming && (
        <ConfirmDangerModal
          title={act === "consent" ? "Confirm consent attestation" : "Confirm release"}
          confirmPhrase={guarantee.id.slice(0, 8)}
          confirmLabel={act === "consent" ? "Record consent" : "Release guarantee"}
          pending={mutation.isPending}
          onConfirm={() => {
            if (mutation.isPending) return;
            mutation.mutate();
          }}
          onClose={() => setConfirming(false)}
        >
          <Banner>
            {act === "consent" ? (
              <>
                This records the guarantor&apos;s consent as a staff-attested fact: the
                pledge of {fmtKes(guarantee.amount)} becomes ACTIVE collateral and stays
                encumbered until released or substituted.
              </>
            ) : (
              <>
                This releases the {fmtKes(guarantee.amount)} pledge and frees the
                guarantor&apos;s capacity. For an active guarantee the remaining cover is
                re-verified by the server; a release that would break the product cover
                rule is refused.
              </>
            )}
          </Banner>
        </ConfirmDangerModal>
      )}
    </Modal>
  );
}
