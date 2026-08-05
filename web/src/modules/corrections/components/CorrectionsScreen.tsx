"use client";

/**
 * Corrections console (P15 follow-on batch 1, issue #31 — audit #30
 * finding R1): the operator workbench for the P13.15 fraud-channel
 * surfaces — repayment adjustments (issue #24 maker-checker), misc
 * fees, committee loan write-offs and the issue-#21 recovery receipts.
 *
 * HONEST SCOPING (deliberate, not an omission): the P13.15 contract
 * exposes NO list/register endpoint for adjustments or write-offs —
 * records are fetched BY ID only. This console therefore works BY
 * REFERENCE: creation flows hand the record id to the checker/committee,
 * and the lookup fields open any record by its id (from the audit
 * trail, which corrections write under their own entity strings). The
 * missing checker worklist is recorded as a CONTRACT FOLLOW-UP on
 * issue #31 — never faked with client-side state.
 *
 * Security posture (transactions/exits precedent):
 * - Route guard is corrections:view (RequireModule); the create
 *   affordances mount only with corrections:create, checker/committee
 *   affordances inside the drawers only with corrections:approve —
 *   pure UX; the server enforces every call (gate 1.6, deny by
 *   default: corrections carry their OWN permission strings, never
 *   generic transactions:edit).
 * - Every rendered string is attacker-influenced data; it renders
 *   exclusively through React text interpolation (gate-tested).
 * - MONEY (blocker (a)): no figure exists on this screen at all —
 *   every money string renders inside the drawers, verbatim from the
 *   API.
 */
import { useState } from "react";
import dynamic from "next/dynamic";
import { Button, Card } from "@genesis/design-system";
import { usePermissions } from "@/modules/authz/usePermissions";
import { can } from "@/modules/authz/schemas";
import { FormField } from "@/modules/forms/FormField";
import { isUuid } from "@/lib/format";
import grid from "@/modules/layout/grid.module.css";
import styles from "./Corrections.module.css";

// Drawer-level code splitting (P15 Phase B speed): drawer chunks load
// on first open, not with the console route.
const AdjustmentRequestDrawer = dynamic(
  () => import("./AdjustmentRequestDrawer").then((m) => m.AdjustmentRequestDrawer),
  { ssr: false },
);
const AdjustmentDetailDrawer = dynamic(
  () => import("./AdjustmentDetailDrawer").then((m) => m.AdjustmentDetailDrawer),
  { ssr: false },
);
const FeeDrawer = dynamic(() => import("./FeeDrawer").then((m) => m.FeeDrawer), { ssr: false });
const WriteOffRequestDrawer = dynamic(
  () => import("./WriteOffRequestDrawer").then((m) => m.WriteOffRequestDrawer),
  { ssr: false },
);
const WriteOffDetailDrawer = dynamic(
  () => import("./WriteOffDetailDrawer").then((m) => m.WriteOffDetailDrawer),
  { ssr: false },
);
const RecoveryReceiptDialog = dynamic(
  () => import("./RecoveryReceiptDialog").then((m) => m.RecoveryReceiptDialog),
  { ssr: false },
);

type DrawerState =
  | null
  | { mode: "adjustment-request" }
  | { mode: "adjustment-detail"; adjustmentId: string }
  | { mode: "fee" }
  | { mode: "write-off-request" }
  | { mode: "write-off-detail"; writeOffId: string }
  | { mode: "receipt"; writeOffId: string };

export function CorrectionsScreen() {
  const permissions = usePermissions();
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [adjustmentLookup, setAdjustmentLookup] = useState("");
  const [adjustmentLookupError, setAdjustmentLookupError] = useState("");
  const [writeOffLookup, setWriteOffLookup] = useState("");
  const [writeOffLookupError, setWriteOffLookupError] = useState("");

  const mayCreate = can(permissions.data, "corrections", "create");

  function openAdjustment() {
    const id = adjustmentLookup.trim();
    if (!isUuid(id)) {
      setAdjustmentLookupError("Enter the full adjustment UUID (8-4-4-4-12 hex).");
      return;
    }
    setAdjustmentLookupError("");
    setDrawer({ mode: "adjustment-detail", adjustmentId: id });
  }

  function openWriteOff() {
    const id = writeOffLookup.trim();
    if (!isUuid(id)) {
      setWriteOffLookupError("Enter the full write-off UUID (8-4-4-4-12 hex).");
      return;
    }
    setWriteOffLookupError("");
    setDrawer({ mode: "write-off-detail", writeOffId: id });
  }

  return (
    <div>
      <div className={grid.cards4}>
        <Card className={grid.half}>
          <div className={styles.cardTitle}>Repayment adjustments</div>
          <div className={styles.cardBody}>
            Two-phase maker-checker reversal of a repayment&apos;s COMPLETE
            allocation: a maker requests, a DIFFERENT checker approves the
            persisted snapshot — only then does the reversal post. No amounts
            are ever entered; every figure derives server-side from the
            original ledger legs.
          </div>
          <div className={styles.cardActions}>
            {mayCreate && (
              <Button
                type="button"
                variant="primary"
                onClick={() => setDrawer({ mode: "adjustment-request" })}
              >
                + Request adjustment
              </Button>
            )}
          </div>
          <div className={styles.lookupRow}>
            <div className={styles.lookupField}>
              <FormField
                id="adjustment-lookup"
                label="Review adjustment by id"
                error={adjustmentLookupError === "" ? undefined : adjustmentLookupError}
                hint="No pending-adjustments register exists on the contract (follow-up on issue #31) — the maker hands the id to the checker."
              >
                {(control) => (
                  <input
                    {...control}
                    className={styles.input}
                    value={adjustmentLookup}
                    onChange={(event) => setAdjustmentLookup(event.target.value)}
                    spellCheck={false}
                  />
                )}
              </FormField>
            </div>
            <Button type="button" onClick={openAdjustment}>
              Open adjustment
            </Button>
          </div>
        </Card>

        <Card className={grid.half}>
          <div className={styles.cardTitle}>Misc fees</div>
          <div className={styles.cardBody}>
            Post a tenant-configured fee against a member (FE- ledger ref).
            The fee AMOUNT is code-owned configuration resolved by the server
            — it cannot be entered here.
          </div>
          <div className={styles.cardActions}>
            {mayCreate && (
              <Button type="button" variant="primary" onClick={() => setDrawer({ mode: "fee" })}>
                + Post fee
              </Button>
            )}
            {!mayCreate && (
              <div className={styles.formNote}>
                Your role has no corrections create permission — posting
                affordances are not offered.
              </div>
            )}
          </div>
        </Card>

        <Card className={grid.wide}>
          <div className={styles.cardTitle}>Loan write-offs &amp; recoveries</div>
          <div className={styles.cardBody}>
            Committee-approved derecognition of an NPL loan bound to a
            write-once snapshot — write-off is NOT forgiveness: the legal claim
            survives, and recovery receipts (issue #21) are the only money-in
            path against it. Votes, void, posting and the recovery trail live
            on the record drawer.
          </div>
          <div className={styles.cardActions}>
            {mayCreate && (
              <Button
                type="button"
                variant="primary"
                onClick={() => setDrawer({ mode: "write-off-request" })}
              >
                + Request write-off
              </Button>
            )}
          </div>
          <div className={styles.lookupRow}>
            <div className={styles.lookupField}>
              <FormField
                id="write-off-lookup"
                label="Open write-off by id"
                error={writeOffLookupError === "" ? undefined : writeOffLookupError}
                hint="No write-off register exists on the contract (follow-up on issue #31) — the requester hands the id to the committee."
              >
                {(control) => (
                  <input
                    {...control}
                    className={styles.input}
                    value={writeOffLookup}
                    onChange={(event) => setWriteOffLookup(event.target.value)}
                    spellCheck={false}
                  />
                )}
              </FormField>
            </div>
            <Button type="button" onClick={openWriteOff}>
              Open write-off
            </Button>
          </div>
        </Card>
      </div>

      {drawer !== null && drawer.mode === "adjustment-request" && (
        <AdjustmentRequestDrawer
          onReview={(adjustmentId) => setDrawer({ mode: "adjustment-detail", adjustmentId })}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer !== null && drawer.mode === "adjustment-detail" && (
        <AdjustmentDetailDrawer
          adjustmentId={drawer.adjustmentId}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer !== null && drawer.mode === "fee" && <FeeDrawer onClose={() => setDrawer(null)} />}
      {drawer !== null && drawer.mode === "write-off-request" && (
        <WriteOffRequestDrawer
          onReview={(writeOffId) => setDrawer({ mode: "write-off-detail", writeOffId })}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer !== null && drawer.mode === "write-off-detail" && (
        <WriteOffDetailDrawer
          writeOffId={drawer.writeOffId}
          onRecordReceipt={() => setDrawer({ mode: "receipt", writeOffId: drawer.writeOffId })}
          onClose={() => setDrawer(null)}
        />
      )}
      {drawer !== null && drawer.mode === "receipt" && (
        <RecoveryReceiptDialog
          writeOffId={drawer.writeOffId}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}
