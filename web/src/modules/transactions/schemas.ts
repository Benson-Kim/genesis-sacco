import { z } from "zod";

/**
 * Zod-validated response boundary for the transactions module (P15
 * module 6 — P11 API). Shapes mirror the generated client types
 * (components["schemas"]["TransactionOut"], AccountTxnOut,
 * InterestRunOut) — the drift-checked OpenAPI snapshot remains the
 * contract; these schemas only assert it at runtime.
 *
 * MONEY RULE (P15 blocker (a)): every monetary field (amount,
 * balance_after, total_interest) is a decimal STRING end-to-end,
 * rendered via fmtKes or verbatim and never coerced or combined
 * arithmetically. Running balances and ledger totals are SERVER facts;
 * the prototype's client-side totals row is deliberately NOT
 * reproduced. Debits and credits are never netted or summed locally.
 */

/** Mirrors the backend TxnType enum (domain/ledger.py). An unknown
 * value is a contract violation and is REJECTED, never rendered. */
export const TXN_TYPES = [
  "deposit",
  "withdrawal",
  "share_topup",
  "loan_disbursement",
  "loan_repayment",
  "interest_posting",
  "exit_settlement",
  "dividend_posting",
  "share_transfer_out",
  "share_transfer_in",
  "fee",
  "loan_write_off",
  "loan_recovery",
] as const;
export const txnTypeSchema = z.enum(TXN_TYPES);
export type TxnType = z.infer<typeof txnTypeSchema>;

export const TXN_TYPE_LABELS: Record<TxnType, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  share_topup: "Share top-up",
  loan_disbursement: "Disbursement",
  loan_repayment: "Loan repayment",
  interest_posting: "Interest",
  exit_settlement: "Exit settlement",
  dividend_posting: "Dividend",
  share_transfer_out: "Share transfer out",
  share_transfer_in: "Share transfer in",
  fee: "Fee",
  loan_write_off: "Write-off",
  loan_recovery: "Recovery",
};

/** Mirrors the backend Channel enum. All four values appear on ledger
 * ROWS (accrual and internal postings are made by server jobs); only
 * the CASH channels are offered on writes (require_cash_channel). */
export const CHANNELS = ["mpesa", "bank", "accrual", "internal"] as const;
export const channelSchema = z.enum(CHANNELS);
export type Channel = z.infer<typeof channelSchema>;

export const CHANNEL_LABELS: Record<Channel, string> = {
  mpesa: "M-Pesa",
  bank: "Bank",
  accrual: "Accrual",
  internal: "Internal",
};

/** Channels on which money physically moves — the ONLY ones the P11
 * write contract accepts (backend require_cash_channel rejects
 * accrual and internal with a 400); the UI never offers what the API
 * forbids (gate 1.6). */
export const CASH_CHANNELS = ["mpesa", "bank"] as const;
export const cashChannelSchema = z.enum(CASH_CHANNELS);
export type CashChannel = z.infer<typeof cashChannelSchema>;

/** Mirrors the backend Side enum — the ledger leg this row reports.
 * The direction decides WHICH column renders the amount; the client
 * never nets a debit against a credit (blocker (a)). */
export const SIDES = ["debit", "credit"] as const;
export const sideSchema = z.enum(SIDES);
export type Side = z.infer<typeof sideSchema>;

export const SIDE_LABELS: Record<Side, string> = {
  debit: "Debit",
  credit: "Credit",
};

/** One ledger row (TransactionOut). The list model carries NO running
 * balance — balances are SERVER facts served on write responses
 * (AccountTxnOut.balance_after) and statements, never reconstructed
 * from list pages. */
export const transactionSchema = z.object({
  id: z.string(),
  txn_ref: z.string(),
  member_id: z.string().nullable(),
  type: txnTypeSchema,
  /** Decimal string — never a number (blocker (a)). */
  amount: z.string(),
  channel: channelSchema,
  direction: sideSchema,
  occurred_at: z.string(),
  is_reversal: z.boolean(),
});

export type Transaction = z.infer<typeof transactionSchema>;

/** Teller-write result (AccountTxnOut): the posted amount and the
 * SERVER-computed balance after, verbatim. Extra keys are STRIPPED at
 * this boundary. */
export const accountTxnSchema = z.object({
  txn_id: z.string(),
  txn_ref: z.string(),
  amount: z.string(),
  balance_after: z.string(),
});

export type AccountTxn = z.infer<typeof accountTxnSchema>;

/** Deposit-interest run result (InterestRunOut) — every figure is the
 * server's (period resolved server-side in strict quarter order; the
 * rate comes exclusively from tenant configuration). */
export const interestRunSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  annual_rate_pct: z.string(),
  scanned: z.number().int(),
  posted: z.number().int(),
  skipped_existing: z.number().int(),
  rate_mismatches: z.number().int(),
  total_interest: z.string(),
  batches: z.number().int(),
});

export type InterestRun = z.infer<typeof interestRunSchema>;

/** The three P11 teller writes this batch owns. Loan repayments ship
 * with the Loan book batch (!59); fees belong to the corrections RBAC
 * module (P13.15) — neither is duplicated here. */
export const TXN_WRITE_KINDS = ["deposit", "withdrawal", "share_topup"] as const;
export const txnWriteKindSchema = z.enum(TXN_WRITE_KINDS);
export type TxnWriteKind = z.infer<typeof txnWriteKindSchema>;

export const TXN_WRITE_KIND_LABELS: Record<TxnWriteKind, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  share_topup: "Share top-up",
};

/** Pure STRING decimal shape (2dp max), rejecting leading zeros —
 * "007.10" is not a ledger amount (!60 F6 lesson). No numeric
 * coercion happens anywhere on this value. */
const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const ALL_ZERO_RE = /^0(?:\.0{1,2})?$/;

/**
 * Client-side pre-validation of the post-transaction form (the server
 * re-validates and is the enforcer — gate 1.6). The amount is
 * validated as a decimal STRING shape and sent as a string: it is
 * never parsed into a float.
 */
export const moneyEntrySchema = z.object({
  kind: txnWriteKindSchema,
  member_id: z.string().min(1, "Select a member."),
  amount: z
    .string()
    .regex(
      DECIMAL_RE,
      "Enter a positive amount (up to 2 decimal places, no leading zeros).",
    )
    .refine((value) => !ALL_ZERO_RE.test(value), {
      message: "Enter an amount greater than zero.",
    }),
  channel: z.enum(CASH_CHANNELS, {
    errorMap: () => ({ message: "Select a channel." }),
  }),
});

export type MoneyEntryInput = z.infer<typeof moneyEntrySchema>;

/** ISO date (YYYY-MM-DD) or empty — the register's date filters. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
