"use client";

/**
 * Transaction detail drawer (P15 module 6 — prototype `vTxn` row
 * drill-down). The P11 contract exposes NO per-transaction read
 * endpoint — this drawer renders the WITNESSED list row: an
 * append-only ledger fact that never changes after it is served
 * (corrections post reversing rows; they never update this one).
 *
 * - EVERY figure renders VERBATIM from the API decimal string
 *   (blocker (a)). The list model carries no running balance and none
 *   is reconstructed here — balances are server facts that live on
 *   write responses and statements (honest limitation in the MR).
 * - The row carries `member_id` only (pattern (b)); the member name
 *   resolves via GET /members/{id}, gated on members:view
 *   (deny-by-default — a role without the grant fetches NOTHING and
 *   sees the opaque id).
 * - Every rendered string (refs, member names) is attacker-influenced
 *   data; it renders exclusively through React text interpolation.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Modal } from "@genesis/design-system";
import { usePermissions } from "@/modules/authz/usePermissions";
import { can } from "@/modules/authz/schemas";
import { fmtDateTime, fmtKes } from "@/lib/format";
import { STALE_TIME } from "@/lib/query";
import { fetchMember } from "@/modules/members/api";
import { CHANNEL_LABELS, SIDE_LABELS, type Transaction } from "../schemas";
import { directionPill, reversalPill, txnTypePill } from "./pills";
import styles from "./Transactions.module.css";

function Kv({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className={styles.kvRow}>
      <span className={styles.kvKey}>{label}</span>
      <span className={styles.kvVal}>{children}</span>
    </div>
  );
}

export function TransactionDetailDrawer({
  txn,
  onClose,
}: Readonly<{
  txn: Transaction;
  onClose: () => void;
}>) {
  const permissions = usePermissions();
  const mayViewMembers = can(permissions.data, "members", "view");

  const memberId = txn.member_id;
  const member = useQuery({
    queryKey: ["members", "detail", memberId ?? "none"],
    queryFn: () => {
      if (memberId === null) return Promise.reject(new Error("no member on this row"));
      return fetchMember(memberId);
    },
    // Deny-by-default: without members:view this drawer fetches NOTHING
    // and renders the opaque id (gate 1.6).
    enabled: memberId !== null && mayViewMembers,
    staleTime: STALE_TIME.record,
  });

  return (
    <Modal title="Transaction detail" onClose={onClose}>
      {txn.is_reversal && (
        <Banner>
          This is a REVERSING entry: the append-only ledger corrects by
          posting a reversal, never by editing the original row.
        </Banner>
      )}
      <div className={styles.detailGrid}>
        <Kv label="Reference">
          <span className={styles.mono}>{txn.txn_ref}</span>
        </Kv>
        <Kv label="Type">{txnTypePill(txn.type, txn.direction)}</Kv>
        <Kv label="Direction">{directionPill(txn.direction)}</Kv>
        <Kv label={`Amount (${SIDE_LABELS[txn.direction]})`}>{fmtKes(txn.amount)}</Kv>
        <Kv label="Channel">{CHANNEL_LABELS[txn.channel]}</Kv>
        <Kv label="Occurred">{fmtDateTime(txn.occurred_at)}</Kv>
        <Kv label="Member">
          {memberId === null ? (
            "— (tenant-level posting)"
          ) : member.data !== undefined ? (
            <>
              {member.data.name} · {member.data.member_no}
            </>
          ) : (
            <span className={styles.mono}>{memberId}</span>
          )}
        </Kv>
        <Kv label="Reversal">{txn.is_reversal ? reversalPill() : "No"}</Kv>
        <Kv label="Ledger row id">
          <span className={styles.mono}>{txn.id}</span>
        </Kv>
      </div>
      <div className={styles.formNote}>
        Ledger rows are immutable server facts. This contract serves no
        per-row running balance — account balances appear on posting
        responses and member statements, and are never reconstructed in
        this screen.
      </div>
    </Modal>
  );
}
