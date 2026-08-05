"use client";

/**
 * Recovery worklist (P15 follow-on batch 1, issue #31 — audit #30
 * finding R1; the P13.16 recovery-officer worklist the prototype's
 * "Initiate recovery" promised): open cases, most delinquent first —
 * the server's order, never re-sorted locally.
 *
 * Security posture:
 * - Route guard is loan_book:view (RequireModule — the P13.16 read
 *   grant); "Initiate recovery" mounts only with loan_book:create;
 *   case writes mount in the drawer only with loan_book:edit. Pure UX;
 *   the server enforces every call (gate 1.6).
 * - LEAST DISCLOSURE (addendum A5): the worklist exposes workflow
 *   facts, days-past-due and the classification pill ONLY — NO
 *   balance, penalty or provision column exists on the contract or
 *   this screen; the loan's money lives behind the Loan book, for the
 *   entitled.
 * - Keyset pagination only (opaque cursors — gate 1.3); the contract
 *   declares NO filter parameters, so no filter UI exists (nothing is
 *   filtered locally).
 * - Staff UUIDs (assignees) render via the !70 short-id convention;
 *   NULL is the honest "unassigned"; a suspended-after-assignment
 *   officer renders the honest flag pill (assignee_unassignable) — the
 *   case is never silently orphaned.
 */
import { useState } from "react";
import dynamic from "next/dynamic";
import { Button, Card, Pill } from "@genesis/design-system";
import { KeysetTable, type Column } from "@/modules/table/KeysetTable";
import { useKeysetList } from "@/modules/table/useKeysetList";
import { usePermissions } from "@/modules/authz/usePermissions";
import { can } from "@/modules/authz/schemas";
import { getOwnUserId } from "@/modules/auth/session";
import { fmtDateTime } from "@/lib/format";
import { loanClassPill } from "@/modules/loans/components/pills";
import { fetchWorklistPage } from "../api";
import type { WorklistRow } from "../schemas";
import styles from "./Recovery.module.css";

// Drawer-level code splitting (P15 Phase B speed).
const OpenCaseDrawer = dynamic(() => import("./OpenCaseDrawer").then((m) => m.OpenCaseDrawer), {
  ssr: false,
});
const CaseDetailDrawer = dynamic(
  () => import("./CaseDetailDrawer").then((m) => m.CaseDetailDrawer),
  { ssr: false },
);

type DrawerState = null | { mode: "open" } | { mode: "detail"; caseId: string };

export function RecoveryScreen() {
  const permissions = usePermissions();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const ownId = getOwnUserId();

  const list = useKeysetList<WorklistRow>({
    queryKey: ["recovery", "worklist"],
    fetchPage: (cursor) => fetchWorklistPage(cursor),
  });

  const mayOpen = can(permissions.data, "loan_book", "create");

  const columns: Column<WorklistRow>[] = [
    {
      key: "dpd",
      header: "Days past due",
      align: "right",
      render: (row) => <span className={styles.dpdCell}>{row.days_past_due}</span>,
    },
    {
      key: "classification",
      header: "Classification",
      render: (row) => loanClassPill(row.classification),
    },
    {
      key: "loan",
      header: "Loan",
      render: (row) => (
        <span className={styles.mono} title={row.loan_id}>
          {row.loan_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "member",
      header: "Member",
      render: (row) => (
        <span className={styles.mono} title={row.member_id}>
          {row.member_id.slice(0, 8)}
        </span>
      ),
    },
    {
      key: "assignee",
      header: "Assignee",
      render: (row) =>
        row.assignee_id !== null ? (
          <>
            {row.assignee_id === ownId ? (
              "you"
            ) : (
              <span className={styles.mono} title={row.assignee_id}>
                {row.assignee_id.slice(0, 8)}
              </span>
            )}{" "}
            {row.assignee_unassignable && (
              <Pill bg="brickSoft" color="brick">
                No longer assignable
              </Pill>
            )}
          </>
        ) : (
          <span className={styles.muted}>— (unassigned)</span>
        ),
    },
    {
      key: "opened",
      header: "Opened",
      render: (row) => <span className={styles.muted}>{fmtDateTime(row.opened_at)}</span>,
    },
    {
      key: "first_assigned",
      header: "First assigned",
      render: (row) => <span className={styles.muted}>{fmtDateTime(row.first_assigned_at)}</span>,
    },
  ];

  return (
    <div>
      <div className={styles.toolbar}>
        {mayOpen && (
          <Button type="button" variant="primary" onClick={() => setDrawer({ mode: "open" })}>
            + Initiate recovery
          </Button>
        )}
      </div>

      <Card padded={false}>
        <div className={styles.registerHead}>
          <span>Recovery worklist</span>
          <span className={styles.registerNote}>
            Open cases, most overdue first — workflow facts only; no balances
            render here (those live behind the Loan book, for the entitled)
          </span>
        </div>
        <KeysetTable
          columns={columns}
          query={list}
          rowKey={(row) => row.case_id}
          emptyMessage="No open recovery cases — nothing is more than 90 days past due, or every case has closed."
          onRowClick={(row) => setDrawer({ mode: "detail", caseId: row.case_id })}
        />
      </Card>

      {drawer !== null && drawer.mode === "open" && (
        <OpenCaseDrawer
          onOpened={(caseId) => setDrawer({ mode: "detail", caseId })}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer !== null && drawer.mode === "detail" && (
        <CaseDetailDrawer caseId={drawer.caseId} onClose={() => setDrawer(null)} />
      )}
    </div>
  );
}
