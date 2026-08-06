import { z } from "zod";
import { moneySchema } from "@/lib/schemas";

/**
 * Zod-validated boundary for the share-transfers console (issue #31
 * batch 6, ledger (e) — audit #30 R2 remainder: the P13.11 share
 * lifecycle's `POST /members/{member_id}/share-transfers` had NO
 * console surface). Shapes mirror the generated client types
 * (components["schemas"]["ShareTransferOut"]) — the drift-checked
 * OpenAPI snapshot remains the contract; these schemas only assert it
 * at runtime.
 *
 * CONTRACT HONESTY (what exists, nothing more): the share-transfers
 * contract is the ONE mutation — there is NO transfer register/list
 * read, NO by-id read and NO version-pinned record behind it (the
 * transfer is atomic and terminal: both member rows are locked
 * server-side, both balances move, the share_transfers row and both
 * ledger legs post in one transaction). This console therefore
 * consumes exactly the POST; the missing read register is RECORDED on
 * issue #31 — never faked client-side from response accumulation.
 *
 * MONEY (P15 blocker (a)): the request amount is the operation's
 * SUBJECT (like a deposit amount — the one caller-known figure),
 * typed as a decimal STRING end-to-end and never parsed into a
 * number. Every response figure (amount echoed, both closing figures)
 * is a server-computed decimal string asserted by moneySchema and
 * rendered VERBATIM — the two balances are never summed, netted or
 * reconciled client-side (non-additive by design: they belong to two
 * different members).
 */

/** ShareTransferOut — every key REQUIRED (key-exact: a missing key is
 * contract drift and refuses to parse; extra keys are stripped). */
export const shareTransferResultSchema = z.object({
  transfer_id: z.string(),
  /** The ST-OUT / ST-IN double-entry pair refs — evidence of BOTH
   * legs of the posting, rendered verbatim. */
  out_txn_ref: z.string(),
  in_txn_ref: z.string(),
  amount: moneySchema,
  from_balance_after: moneySchema,
  to_balance_after: moneySchema,
});

export type ShareTransferResult = z.infer<typeof shareTransferResultSchema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Client-side pre-validation of the entry form (the server
 * re-validates and is the enforcer — gate 1.6: 2dp bound at the
 * contract, balance check under BOTH member row locks, active-member
 * and distinct-members checks server-side).
 */
export const transferEntrySchema = z
  .object({
    from_member_id: z
      .string()
      .min(1, "The transferring member id is required.")
      .regex(UUID_RE, "Enter the full member UUID (8-4-4-4-12 hex)."),
    to_member_id: z
      .string()
      .min(1, "The receiving member id is required.")
      .regex(UUID_RE, "Enter the full member UUID (8-4-4-4-12 hex)."),
    amount: z
      .string()
      .min(1, "Enter the amount to transfer.")
      .regex(
        /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/,
        "Decimal amount, e.g. 5000 or 5000.50 — no leading zeros.",
      )
      .refine((value) => value !== "0" && value !== "0.0" && value !== "0.00", {
        message: "The amount must be greater than zero.",
      }),
  })
  .superRefine((entry, ctx) => {
    // The server refuses a self-transfer regardless; refusing it here
    // saves the operator a pointless armed confirmation.
    if (
      UUID_RE.test(entry.from_member_id) &&
      entry.from_member_id.toLowerCase() === entry.to_member_id.toLowerCase()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["to_member_id"],
        message: "Shares cannot be transferred to the same member.",
      });
    }
  });

export type TransferEntry = z.infer<typeof transferEntrySchema>;
