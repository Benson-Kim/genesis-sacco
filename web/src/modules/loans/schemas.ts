import { z } from "zod";

/**
 * Zod-validated response boundary for the loan-book module (P15 module 4
 * — P10 API). Shapes mirror the generated client types
 * (components["schemas"]["LoanOut"] etc.) — the drift-checked OpenAPI
 * snapshot remains the contract; these schemas only assert it at
 * runtime.
 *
 * MONEY RULE (P15 blocker (a)): every monetary field (principal,
 * balance, penalty_due, schedule/quote figures, portfolio aggregates)
 * is a decimal STRING end-to-end, rendered via fmtKes or verbatim and
 * never coerced or combined arithmetically. Outstanding balances,
 * arrears classification, provisioning, schedules, settlement totals
 * and repayment allocations are SERVER facts.
 */

/** Mirrors the backend LoanStatus enum. An unknown value is a contract
 * violation and is REJECTED, never silently rendered. */
export const LOAN_STATUSES = ["active", "closed", "written_off"] as const;
export const loanStatusSchema = z.enum(LOAN_STATUSES);
export type LoanStatus = z.infer<typeof loanStatusSchema>;

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  active: "Active",
  closed: "Closed",
  written_off: "Written off",
};

/** Mirrors the backend LoanClass enum (arrears classification — a
 * SERVER-computed fact from the nightly arrears job; the prototype's
 * client-side classify(days) is deliberately NOT reproduced). */
export const LOAN_CLASSES = [
  "normal",
  "watch",
  "substandard",
  "doubtful",
  "loss",
] as const;
export const loanClassSchema = z.enum(LOAN_CLASSES);
export type LoanClass = z.infer<typeof loanClassSchema>;

export const LOAN_CLASS_LABELS: Record<LoanClass, string> = {
  normal: "Normal",
  watch: "Watch",
  substandard: "Substandard",
  doubtful: "Doubtful",
  loss: "Loss",
};

export const loanSchema = z.object({
  id: z.string(),
  application_id: z.string(),
  member_id: z.string(),
  product_id: z.string(),
  /** Decimal strings — never numbers (blocker (a)). */
  principal: z.string(),
  balance: z.string(),
  rate_pct: z.string(),
  term_months: z.number().int(),
  status: loanStatusSchema,
  classification: loanClassSchema,
  days_past_due: z.number().int(),
  /** Decimal string — the tenant's provisioning rate for the class; the
   * derived provision KES figure is NOT computed client-side (the
   * portfolio summary carries the server-computed total). */
  provision_pct: z.string(),
  penalty_due: z.string(),
  disbursed_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  version: z.number().int(),
});

export type Loan = z.infer<typeof loanSchema>;

/** One repayment-schedule installment (ScheduleRowOut) — every figure a
 * server-computed decimal string, rendered verbatim. */
export const scheduleRowSchema = z.object({
  installment_no: z.number().int(),
  due_date: z.string(),
  principal_due: z.string(),
  interest_due: z.string(),
  total_due: z.string(),
  paid_amount: z.string(),
});

export const scheduleSchema = z.array(scheduleRowSchema);
export type ScheduleRow = z.infer<typeof scheduleRowSchema>;

/** Early settlement quote (SettlementQuoteOut) — as-of stamped server
 * facts; the total is the SERVER's sum, never recomputed here. */
export const settlementQuoteSchema = z.object({
  as_of: z.string(),
  principal_balance: z.string(),
  interest_due: z.string(),
  penalties_due: z.string(),
  total: z.string(),
});

export type SettlementQuote = z.infer<typeof settlementQuoteSchema>;

/** Disbursement result (DisbursementOut): the created loan id, the
 * ledger transaction reference and the SERVER-computed schedule. Extra
 * keys are STRIPPED at this boundary. */
export const disbursementSchema = z.object({
  loan_id: z.string(),
  txn_id: z.string(),
  txn_ref: z.string(),
  schedule: scheduleSchema,
});

export type Disbursement = z.infer<typeof disbursementSchema>;

/** Repayment result (RepaymentOut): the allocation (penalties, then
 * interest, then principal — allocated SERVER-side), the balance after
 * and the loan status after. All decimal strings, rendered verbatim. */
export const repaymentResultSchema = z.object({
  txn_id: z.string(),
  txn_ref: z.string(),
  penalties: z.string(),
  interest: z.string(),
  principal: z.string(),
  balance_after: z.string(),
  penalty_due_after: z.string(),
  status: loanStatusSchema,
});

export type RepaymentResult = z.infer<typeof repaymentResultSchema>;

/** Portfolio aggregates (PortfolioSummaryOut) — the NPL, PAR-30 and
 * provisioning figures are server-computed; the prototype's client-side
 * reductions over loan rows are deliberately NOT reproduced. */
export const classificationSliceSchema = z.object({
  classification: loanClassSchema,
  count: z.number().int(),
  balance: z.string(),
  provisions: z.string(),
});

export const portfolioSummarySchema = z.object({
  active_loans: z.number().int(),
  outstanding_balance: z.string(),
  npl_balance: z.string(),
  npl_ratio_pct: z.string(),
  par30_balance: z.string(),
  par30_ratio_pct: z.string(),
  provisions: z.string(),
  penalties_due: z.string(),
  by_classification: z.array(classificationSliceSchema),
});

export type PortfolioSummary = z.infer<typeof portfolioSummarySchema>;

/** Money-movement channels the P10 contract accepts for disbursement
 * and repayments (require_cash_channel: mpesa | bank — accrual/internal
 * are engine-owned and the UI never offers them). */
export const CASH_CHANNELS = ["mpesa", "bank"] as const;
export const cashChannelSchema = z.enum(CASH_CHANNELS);
export type CashChannel = z.infer<typeof cashChannelSchema>;

export const CHANNEL_LABELS: Record<CashChannel, string> = {
  mpesa: "M-Pesa",
  bank: "Bank",
};

/** Leading zeros rejected (W59-5, the !60 F6 class): "007.10" is not a
 * well-formed decimal string and the typed-confirmation banner must
 * never render "KES 007.10". Pure string shape — no numeric coercion. */
const DECIMAL_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const ALL_ZERO_RE = /^0(?:\.0{1,2})?$/;

/**
 * Client-side pre-validation of the repayment form (the server
 * re-validates and is the enforcer — gate 1.6). The amount is validated
 * as a decimal STRING shape (2dp, non-zero — pure string inspection,
 * no numeric coercion) and sent as a string: it is never parsed into a
 * float.
 */
export const repaymentCreateSchema = z.object({
  amount: z
    .string()
    .regex(DECIMAL_RE, "Enter a positive amount (up to 2 decimal places).")
    .refine((value) => !ALL_ZERO_RE.test(value), {
      message: "Enter an amount greater than zero.",
    }),
  channel: z.enum(CASH_CHANNELS, {
    errorMap: () => ({ message: "Select a channel." }),
  }),
});

export type RepaymentCreateInput = z.infer<typeof repaymentCreateSchema>;
