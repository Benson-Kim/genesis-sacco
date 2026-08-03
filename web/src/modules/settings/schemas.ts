import { z } from "zod";

/**
 * Zod-validated response boundary for the tenant-settings API (P15,
 * Settings module — P13.7 backend). Shapes mirror the generated client
 * types (components["schemas"]["SettingsOut"]); the drift-checked
 * OpenAPI snapshot remains the contract; these schemas only assert it
 * at runtime.
 *
 * MONEY RULE (P15 blocker (a)): every rate/amount travels as an API
 * decimal STRING, renders verbatim and is SUBMITTED as a string — the
 * client never coerces, compares or computes money values. Ordering /
 * contiguity of bands is enforced by the server (422 with field
 * messages) — the client deliberately does NOT compare amounts.
 */
export const rateBandSchema = z.object({
  min_amount: z.string(),
  max_amount: z.string().nullable(),
  rate_pct: z.string(),
});

export const approvalBandSchema = z.object({
  authority: z.string(),
  max_amount: z.string().nullable(),
});

export type RateBand = z.infer<typeof rateBandSchema>;
export type ApprovalBand = z.infer<typeof approvalBandSchema>;

export const settingsSchema = z.object({
  configured: z.boolean(),
  version: z.number().int(),
  /** Names of stored keys that failed read-side revalidation — NAMES
   * only, never the corrupt payload (least disclosure, P13.7 R3). */
  corrupt_keys: z.array(z.string()),
  deposit_interest_annual_rate_pct: z.string().nullable(),
  dividend_rate_pct: z.string().nullable(),
  deposit_rebate_rate_pct: z.string().nullable(),
  penalty_rate_pct_per_month: z.string().nullable(),
  penalty_grace_days: z.number().int().nullable(),
  // Enum-carrying strings degrade gracefully to text (the F-A5
  // users-status precedent): an unknown value renders inert and the
  // select falls back to "not configured"; the server enforces the
  // vocabulary regardless.
  penalty_charged_on: z.string().nullable(),
  loan_interest_method: z.string().nullable(),
  loan_interest_basis: z.string().nullable(),
  loan_rate_bands: z.array(rateBandSchema).nullable(),
  min_share_capital: z.string().nullable(),
  registration_fee: z.string().nullable(),
  min_monthly_contribution: z.string().nullable(),
  max_member_exposure: z.string().nullable(),
  dormancy_period_months: z.number().int().nullable(),
  financial_year_end_month: z.number().int().nullable(),
  exit_notice_period_days: z.number().int().nullable(),
  exit_fee: z.string().nullable(),
  committee_size: z.number().int().nullable(),
  committee_quorum: z.number().int().nullable(),
  approval_bands: z.array(approvalBandSchema).nullable(),
});

export type Settings = z.infer<typeof settingsSchema>;

/** Code-owned enum vocabularies (mirror the generated client enums). */
export const LOAN_INTEREST_METHODS = ["reducing_balance", "flat"] as const;
export const LOAN_INTEREST_BASES = ["thirty_360", "actual_365"] as const;
export const PENALTY_CHARGED_ON = ["instalment_in_arrears", "full_outstanding"] as const;

export const METHOD_LABELS: Record<(typeof LOAN_INTEREST_METHODS)[number], string> = {
  reducing_balance: "Reducing balance",
  flat: "Flat rate",
};
export const BASIS_LABELS: Record<(typeof LOAN_INTEREST_BASES)[number], string> = {
  thirty_360: "30/360",
  actual_365: "Actual/365",
};
export const CHARGED_ON_LABELS: Record<(typeof PENALTY_CHARGED_ON)[number], string> = {
  instalment_in_arrears: "Instalment in arrears",
  full_outstanding: "Full outstanding balance",
};

/**
 * Approval-band authorities are the CODE-OWNED platform role names
 * (backend genesis/domain/rbac.py ROLE_NAMES — immutable by DB trigger).
 * Mirrored here as UX convenience only, the same precedent as
 * authz/modules.ts mirroring the Module enum; the server validates the
 * vocabulary regardless (an unknown authority is a 422).
 */
export const AUTHORITY_ROLE_NAMES = [
  "System Admin",
  "Branch Manager",
  "Loan Officer",
  "Teller",
  "Credit Committee",
  "Accountant",
  "Auditor",
] as const;

/** Month labels for financial_year_end_month (1–12). */
export const FY_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/* ------------------------------------------------------------------ *
 * Form-side string validation (pure regex — no numeric conversion of
 * money values anywhere). Bounds beyond shape (e.g. rate <= 100) are
 * the server's verdict, rendered from 422 field messages.
 * ------------------------------------------------------------------ */

/** numeric(5,2) rate/percentage strings. */
export const RATE_RE = /^\d{1,3}(\.\d{1,2})?$/;
/** NUMERIC(18,2) amount strings. */
export const AMOUNT_RE = /^\d{1,16}(\.\d{1,2})?$/;
/** Whole-number strings for count/period fields. */
export const INT_RE = /^\d+$/;

export type ParsedField<T> =
  | { ok: true; value: T | null }
  | { ok: false; message: string };

/** Blank clears the key (null); otherwise the string must match. */
export function parseOptionalDecimal(
  raw: string,
  re: RegExp,
  message: string,
): ParsedField<string> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!re.test(trimmed)) return { ok: false, message };
  return { ok: true, value: trimmed };
}

/** Blank clears the key (null); otherwise a bounded whole number. */
export function parseOptionalInt(raw: string, min: number, max: number): ParsedField<number> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!INT_RE.test(trimmed)) return { ok: false, message: "Whole number only" };
  const parsed = Number(trimmed);
  if (parsed < min || parsed > max) {
    return { ok: false, message: `Between ${min} and ${max}` };
  }
  return { ok: true, value: parsed };
}
