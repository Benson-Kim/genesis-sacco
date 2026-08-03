import { z } from "zod";

/**
 * Zod-validated response boundary for the loan-applications / committee
 * module (P15 module 3 — P9 API). Shapes mirror the generated client
 * types (components["schemas"]["ApplicationOut"] etc.) — the
 * drift-checked OpenAPI snapshot remains the contract; these schemas
 * only assert it at runtime.
 *
 * MONEY RULE (P15 blocker (a)): amount / rate_pct / cover_pct /
 * max_eligible are decimal STRINGS end-to-end. They are rendered via
 * fmtKes / verbatim text and never coerced or combined arithmetically —
 * the server computes every derived figure (cover%, eligibility).
 */

/** Mirrors the backend ApplicationStage enum; the stage drives filters
 * and the workflow indicator, so an unknown value is a contract
 * violation and is REJECTED, never silently rendered (members-module
 * precedent, !56 F-A5 rationale). */
export const APPLICATION_STAGES = [
  "submitted",
  "appraisal",
  "committee",
  "approved",
  "rejected",
  "disbursed",
] as const;

export const applicationStageSchema = z.enum(APPLICATION_STAGES);
export type ApplicationStage = z.infer<typeof applicationStageSchema>;

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  submitted: "Submitted",
  appraisal: "Appraisal",
  committee: "Committee",
  approved: "Approved",
  rejected: "Rejected",
  disbursed: "Disbursed",
};

export const applicationSchema = z.object({
  id: z.string(),
  member_id: z.string(),
  product_id: z.string(),
  /** Decimal string — never a number (blocker (a)). */
  amount: z.string(),
  term_months: z.number().int(),
  /** Decimal string — server-resolved from the product (v1.1 rule 1). */
  rate_pct: z.string(),
  purpose: z.string().nullable(),
  stage: applicationStageSchema,
  /** Decimal string — server-computed (deposits + guarantees vs amount). */
  cover_pct: z.string(),
  max_eligible: z.string().nullable().optional(),
  version: z.number().int(),
});

export type Application = z.infer<typeof applicationSchema>;

/** Committee tally after a vote (VoteResultOut) — COUNTS + decision only;
 * the server never discloses who voted which way through this endpoint. */
export const voteResultSchema = z.object({
  approvals: z.number().int(),
  rejections: z.number().int(),
  decision: z.string().nullable(),
  stage: z.string(),
});

export type VoteResult = z.infer<typeof voteResultSchema>;

export const VOTES = ["approve", "reject"] as const;
export type Vote = (typeof VOTES)[number];

/** Loan-product reference data (ProductOut) consumed READ-ONLY here for
 * the intake form and product-name display; product administration is
 * the Settings/products module (P15 module 9). Money-ish fields are
 * decimal strings, rendered verbatim. */
export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  rate_pct: z.string(),
  deposit_multiplier: z.string(),
  max_term_months: z.number().int(),
  guarantors_required: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
});

export const productsSchema = z.array(productSchema);
export type Product = z.infer<typeof productSchema>;

const DECIMAL_RE = /^\d+(?:\.\d{1,2})?$/;

/**
 * Client-side pre-validation of the intake form (the server re-validates
 * and is the enforcer — gate 1.6). The amount is validated as a decimal
 * STRING shape and sent as a string: it is never parsed into a float.
 * Rate/pricing are NOT here — the API resolves them from the product and
 * rejects caller-sent pricing (extra="forbid", v1.1 rule 1).
 */
export const applicationCreateSchema = z.object({
  member_id: z.string().uuid({ message: "Select a member." }),
  product_id: z.string().uuid({ message: "Select a loan product." }),
  amount: z
    .string()
    .regex(DECIMAL_RE, "Enter a positive amount (up to 2 decimal places)."),
  term_months: z
    .number({ invalid_type_error: "Enter the term in months." })
    .int("Enter whole months.")
    .min(1, "Term must be at least 1 month.")
    .max(600, "Term looks too long — check the value."),
  purpose: z.string().max(500, "Keep the purpose under 500 characters.").nullable(),
});

export type ApplicationCreateInput = z.infer<typeof applicationCreateSchema>;
