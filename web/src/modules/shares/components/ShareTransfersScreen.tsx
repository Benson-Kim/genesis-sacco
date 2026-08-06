"use client";

/**
 * Share-transfers console (issue #31 batch 6, ledger (e) — audit #30
 * R2 remainder: the P13.11 share lifecycle's exit-path transfer had
 * NO console surface). Consumes EXACTLY what the contract exposes:
 * the one mutation `POST /members/{member_id}/share-transfers`
 * (members:approve server-side — moving member equity, the P12
 * settlement precedent).
 *
 * CONTRACT HONESTY: there is NO transfer register/list read and NO
 * by-id read on this contract — the missing read register is RECORDED
 * on issue #31 and this screen states it plainly instead of faking a
 * history from accumulated responses. The transfer trail is auditable
 * via the ledger (ST-OUT/ST-IN refs render on the result panel) and
 * the audit log.
 *
 * Security posture (the corrections/recovery precedent):
 * - Route guard is members:view (RequireModule); the transfer form
 *   mounts ONLY with members:approve — pure UX; the server enforces
 *   every call (gate 1.6, deny by default).
 * - MONEY (blocker (a)): the amount is the operation's SUBJECT — the
 *   typed decimal STRING end-to-end, never a float. Every result
 *   figure (amount, BOTH closing figures) renders VERBATIM via fmtKes;
 *   the two balances belong to two different members and are NEVER
 *   summed, netted or reconciled client-side.
 * - EXACTLY ONE write per intent: ConfirmDangerModal typed phrase
 *   (the transferring member's id prefix — byte-identical compare),
 *   pending short-circuit, `retry: 0`, one Idempotency-Key per
 *   logical intent (README MATERIAL rule: canonical entry + reload
 *   epoch + per-SUCCESS intent counter — a legitimate identical
 *   second transfer is a NEW intent, never served the stored
 *   response; there is no record version on this contract to fold).
 * - A 409 (insufficient share balance under the row locks, inactive
 *   member, self-transfer) renders the shared ConflictBanner's
 *   explicit reload-and-re-enter flow — NOTHING is replayed.
 * - Every rendered string is attacker-influenced data; it renders
 *   exclusively through React text interpolation (gate-tested).
 */
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ApiError, idempotencyKeyFor, type IdempotencyKeySlot } from "@genesis/api-client";
import { Banner, Button, Card, ConfirmDangerModal } from "@genesis/design-system";
import { FormField } from "@/modules/forms/FormField";
import {
  fromApiError,
  fromZodError,
  mergeFieldErrors,
  type FieldErrors,
} from "@/modules/forms/form-errors";
import { ConflictBanner } from "@/modules/layout/ConflictBanner";
import { ErrorBanner } from "@/modules/layout/ErrorBanner";
import { announce } from "@/modules/layout/announcer";
import { usePermissions } from "@/modules/authz/usePermissions";
import { can } from "@/modules/authz/schemas";
import { isConflict } from "@/lib/errors";
import { fmtKes } from "@/lib/format";
import grid from "@/modules/layout/grid.module.css";
import { transferShares } from "../api";
import {
  transferEntrySchema,
  type ShareTransferResult,
  type TransferEntry,
} from "../schemas";
import styles from "./Shares.module.css";

function Kv({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className={styles.kvRow}>
      <span className={styles.kvKey}>{label}</span>
      <span className={styles.kvVal}>{children}</span>
    </div>
  );
}

export function ShareTransfersScreen() {
  const permissions = usePermissions();
  const [fromMemberId, setFromMemberId] = useState("");
  const [toMemberId, setToMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [confirmEntry, setConfirmEntry] = useState<TransferEntry | null>(null);
  const [result, setResult] = useState<ShareTransferResult | null>(null);
  const [notice, setNotice] = useState<string>("");
  // Freshness component for the idempotency key (!60 F3): bumped on
  // every explicit post-conflict reload — a re-entered identical
  // transfer after a 409 is a NEW intent with a NEW key.
  const [reloadEpoch, setReloadEpoch] = useState(0);
  // Per-success intent counter (the T2 lesson): a SECOND transfer of
  // the same amount between the same members is legitimate and is a
  // NEW intent — never served the first transfer's stored response.
  const [intentSeq, setIntentSeq] = useState(0);
  const keySlot = useRef<IdempotencyKeySlot>({ key: null, body: null });

  const transfer = useMutation({
    mutationFn: (entry: TransferEntry) =>
      transferShares(
        entry.from_member_id,
        entry.to_member_id,
        entry.amount,
        idempotencyKeyFor(
          keySlot.current,
          JSON.stringify({
            op: "share-transfer",
            from: entry.from_member_id,
            to: entry.to_member_id,
            amount: entry.amount,
            reload_epoch: reloadEpoch,
            intent_seq: intentSeq,
          }),
        ),
      ),
    onSuccess: (posted) => {
      setConfirmEntry(null);
      // SPENT affordance: the result panel replaces the form.
      setResult(posted);
      // The NEXT transfer is a new intent even if byte-identical (T2).
      setIntentSeq((seq) => seq + 1);
      setNotice("");
      announce("Share transfer posted — both ledger legs recorded.");
    },
    onError: () => {
      setConfirmEntry(null);
      announce("The share transfer was NOT posted.");
    },
  });

  const mayTransfer = can(permissions.data, "members", "approve");
  const conflict = transfer.isError && isConflict(transfer.error);
  const spent = result !== null;

  function reloadAfterConflict() {
    // Explicit reload flow (!60 F5): there is no record read on this
    // contract to refetch — the conflicted attempt posted NOTHING
    // (server-verified under both row locks); the operator re-checks
    // the member's shares in the Members module and re-enters. The
    // stale intent is NEVER replayed: its key rotates via the epoch.
    setReloadEpoch((epoch) => epoch + 1);
    transfer.reset();
    setNotice(
      "Nothing was posted by the conflicted attempt. Re-check the transferring member's share balance and status (Members module) before re-entering — the transfer must clear the balance check under the server's row locks.",
    );
    announce("Conflict acknowledged — nothing was posted; re-check the member before re-entering.");
  }

  function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (transfer.isPending || spent) return;
    const parsed = transferEntrySchema.safeParse({
      from_member_id: fromMemberId.trim(),
      to_member_id: toMemberId.trim(),
      amount: amount.trim(),
    });
    if (!parsed.success) {
      setClientErrors(fromZodError(parsed.error));
      return;
    }
    setClientErrors({});
    setConfirmEntry(parsed.data);
  }

  // Server 422 verdicts WIN over the client's guesses per field.
  const serverErrors = fromApiError(transfer.error);
  const fieldErrors = mergeFieldErrors(clientErrors, serverErrors);
  const renderedInline =
    transfer.error instanceof ApiError &&
    transfer.error.status === 422 &&
    Object.keys(serverErrors).length > 0;

  return (
    <div>
      <div className={grid.cards4}>
        <Card className={grid.wide}>
          <div className={styles.cardTitle}>Share transfers</div>
          <div className={styles.cardBody}>
            Transfer share capital from one active member to another — the
            exit path for a member whose shares move rather than pay out.
            Both member rows are locked server-side, the balance check runs
            under those locks, and BOTH double-entry legs (ST-OUT / ST-IN)
            post atomically with the transfer record. The contract exposes
            no transfer register to consult here (recorded on issue #31 as
            a contract follow-up — never faked client-side): the trail is
            auditable via the ledger refs below and the audit log.
          </div>
        </Card>
      </div>

      <Card>
        {notice !== "" && <Banner>{notice}</Banner>}

        {/* One copy of the 409 reload-and-re-enter flow (gate 1.1). */}
        <ConflictBanner error={transfer.error} onReload={reloadAfterConflict} />
        {transfer.isError && !conflict && !renderedInline && (
          <ErrorBanner error={transfer.error} />
        )}

        {spent && result !== null && (
          <div className={styles.resultPanel} role="status">
            <div className={styles.resultTitle}>
              Transfer posted · {result.out_txn_ref} / {result.in_txn_ref}
            </div>
            <Kv label="Transfer">
              <span className={styles.mono} title={result.transfer_id}>
                {result.transfer_id.slice(0, 8)}
              </span>
            </Kv>
            <Kv label="Amount transferred">
              <span className={styles.amountCell}>{fmtKes(result.amount)}</span>
            </Kv>
            <Kv label="Transferor shares after">
              <span className={styles.amountCell}>{fmtKes(result.from_balance_after)}</span>
            </Kv>
            <Kv label="Transferee shares after">
              <span className={styles.amountCell}>{fmtKes(result.to_balance_after)}</span>
            </Kv>
            <div className={styles.formNote}>
              Every figure above is the SERVER&apos;s from the transfer
              response — the two balances belong to two different members
              and nothing is summed or reconciled in this screen. The
              ledger is append-only; a mistaken transfer is corrected by a
              counter-transfer, never an edit.
            </div>
            <div className={styles.actions}>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  // A NEW intent: entry cleared; fresh key material by
                  // content + intent_seq.
                  setResult(null);
                  setFromMemberId("");
                  setToMemberId("");
                  setAmount("");
                  setClientErrors({});
                  transfer.reset();
                }}
              >
                Record another transfer
              </Button>
            </div>
          </div>
        )}

        {!spent && mayTransfer && (
          <form onSubmit={submitEntry} noValidate>
            <FormField
              id="transfer-from"
              label="Transferring member id"
              error={fieldErrors["from_member_id"]}
              hint="The member whose shares move out (must be active; the server verifies)."
            >
              {(control) => (
                <input
                  {...control}
                  className={styles.input}
                  value={fromMemberId}
                  onChange={(event) => setFromMemberId(event.target.value)}
                  disabled={transfer.isPending}
                  spellCheck={false}
                />
              )}
            </FormField>
            <FormField
              id="transfer-to"
              label="Receiving member id"
              error={fieldErrors["to_member_id"]}
              hint="The active member receiving the shares."
            >
              {(control) => (
                <input
                  {...control}
                  className={styles.input}
                  value={toMemberId}
                  onChange={(event) => setToMemberId(event.target.value)}
                  disabled={transfer.isPending}
                  spellCheck={false}
                />
              )}
            </FormField>
            <FormField
              id="transfer-amount"
              label="Amount (KES)"
              error={fieldErrors["amount"]}
              hint="The share capital to move — the server refuses any amount exceeding the transferor's share balance."
            >
              {(control) => (
                <input
                  {...control}
                  className={styles.input}
                  inputMode="decimal"
                  maxLength={18}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={transfer.isPending}
                />
              )}
            </FormField>
            <div className={styles.formNote}>
              The balance check, active-member checks and the posting date
              are all resolved by the server under both member row locks —
              a shortfall conflicts with nothing posted.
            </div>
            <div className={styles.actions}>
              <Button type="submit" variant="primary" disabled={transfer.isPending}>
                {transfer.isPending ? "Transferring…" : "Transfer shares…"}
              </Button>
            </div>
          </form>
        )}
        {!spent && !mayTransfer && (
          <div className={styles.formNote}>
            Your role has no members approval permission — share transfers
            move member equity and their controls are not offered. The
            server enforces this regardless.
          </div>
        )}
      </Card>

      {confirmEntry !== null && (
        <ConfirmDangerModal
          title="Transfer share capital"
          confirmPhrase={confirmEntry.from_member_id.slice(0, 8)}
          confirmLabel="Transfer shares"
          pending={transfer.isPending}
          onConfirm={() => {
            if (!transfer.isPending) transfer.mutate(confirmEntry);
          }}
          onClose={() => setConfirmEntry(null)}
        >
          <Banner>
            This moves {fmtKes(confirmEntry.amount)} of share capital from
            member {confirmEntry.from_member_id.slice(0, 8)} to member{" "}
            {confirmEntry.to_member_id.slice(0, 8)} — both ledger legs post
            atomically and the ledger is append-only (a mistake is corrected
            by a counter-transfer, never an edit). The server verifies both
            members and the balance under row locks before posting.
          </Banner>
        </ConfirmDangerModal>
      )}
    </div>
  );
}
