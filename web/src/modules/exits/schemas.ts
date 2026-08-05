import { z } from "zod";
import { isoTimestampSchema, moneySchema, signedMoneySchema } from "@/lib/schemas";

/**
 * Zod-validated response boundary for the Member exit module (P15
 * module 7 — the P12 exit & settlement API). Shapes mirror the
 * generated client types (components["schemas"]["ExitOut"],
 * ExitStatementOut, ExitVoteResultOut, SettlementOut) — the
 * drift-checked OpenAPI snapshot remains the contract; these schemas
 * only assert it at runtime.
 *
 * MONEY RULE (P15 blocker (a)) — the most money-critical surface of
 * the batch order (terminal settlement: share refunds, loan offsets,
 * fee deductions): every settlement figure (shares_amount,
 * deposits_amount, loan_balance, fees, net_payable, equity) is a
 * SERVER-computed decimal STRING snapshotted under the P12 lock set.
 * They render verbatim via fmtKes and are NEVER coerced, combined,
 * netted or re-derived client-side — the client does not even verify
 * that net_payable equals its components (that re-verification is the
 * server's, component-by-component, at posting time). A NEGATIVE
 * net_payable (loan balance exceeds assets) is a documented, legitimate
 * server branch and renders verbatim with its sign.
 */

/** Mirrors the backend ExitStatus enum (domain/exits.py). An unknown
 * value is a contract violation and is REJECTED, never rendered — an
 * unrecognised status must never arm a lifecycle write. Terminal
 * states: settled, rejected (void narrows requested/approved →
 * rejected; there is no separate "voided" status in the contract). */
export const EXIT_STATUSES = ["requested", "approved", "settled", "rejected"] as const;
export const exitStatusSchema = z.enum(EXIT_STATUSES);
export type ExitStatus = z.infer<typeof exitStatusSchema>;

export const EXIT_STATUS_LABELS: Record<ExitStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  settled: "Settled",
  rejected: "Rejected",
};

/** The terminal states: every write affordance is structurally
 * WITHDRAWN for them (the server enforces the transition matrix
 * regardless — gate 1.6). */
export const TERMINAL_EXIT_STATUSES: readonly ExitStatus[] = ["settled", "rejected"];

export function isTerminalExitStatus(status: ExitStatus): boolean {
  return TERMINAL_EXIT_STATUSES.includes(status);
}

/**
 * ISO-8601 datetime SHAPE for the exit timestamps (the !63 F-R4
 * lesson) and canonical SERVER money decimal SHAPE (review F-M2):
 * SHARED shapes from `@/lib/schemas` — the single copy (gate 1.1,
 * issue #30 A2/S2); this module was their reference implementation.
 *
 * The sign: shares_amount, deposits_amount, loan_balance and fees
 * carry DB CHECK (>= 0) constraints (migrations 0001/0010) and equity
 * is the server sum of two non-negative components — a '-' on any of
 * them is a contract violation and is REJECTED (`moneySchema`).
 * net_payable deliberately has NO such CHECK (migration 0010: the
 * documented loan-exceeds-assets branch) — it alone accepts a leading
 * '-' (`signedMoneySchema`) and renders verbatim with its sign.
 */
const timestampSchema = isoTimestampSchema;

/** One exit request with its settlement SNAPSHOT (ExitOut). Every
 * money field is a decimal string in the CANONICAL server shape
 * (F-M2) — a numeric value or a garbage string is a contract
 * violation and is REJECTED. Extra keys are STRIPPED at this
 * boundary. */
export const exitSchema = z.object({
  id: z.string(),
  member_id: z.string(),
  status: exitStatusSchema,
  reason: z.string().nullable(),
  /** Snapshot components, server-computed under the P12 lock set. */
  shares_amount: moneySchema,
  deposits_amount: moneySchema,
  loan_balance: moneySchema,
  fees: moneySchema,
  /** May legitimately be NEGATIVE (loan balance exceeds assets). */
  net_payable: signedMoneySchema,
  decided_at: timestampSchema.nullable(),
  settled_at: timestampSchema.nullable(),
  settlement_txn_id: z.string().nullable(),
  /** Optimistic-lock version pinning void/settlement writes (1.4). */
  version: z.number().int(),
  created_at: timestampSchema,
});

export type ExitRecord = z.infer<typeof exitSchema>;

/** Committee tally after an exit vote (ExitVoteResultOut — the P9
 * voting machinery reused by P12): COUNTS + decision + the record's
 * resulting status only; the server never discloses who voted which
 * way through this endpoint. `decision` and `status` REJECT unknown
 * vocabulary (W58-4 posture). */
export const exitVoteResultSchema = z.object({
  approvals: z.number().int(),
  rejections: z.number().int(),
  decision: z.enum(["approved", "rejected"]).nullable(),
  status: exitStatusSchema,
});

export type ExitVoteResult = z.infer<typeof exitVoteResultSchema>;

export const EXIT_VOTES = ["approve", "reject"] as const;
export type ExitVote = (typeof EXIT_VOTES)[number];

/** Settlement posting result (SettlementOut): the updated exit record
 * plus the ledger transaction ref — SERVER facts, verbatim. */
export const settlementResultSchema = z.object({
  exit: exitSchema,
  txn_ref: z.string().nullable(),
});

export type SettlementResult = z.infer<typeof settlementResultSchema>;

/** Mirrors the backend MemberStatus enum for the statement's
 * member_status field — reject-unknowns, consistent with the members
 * module boundary. */
const statementMemberStatusSchema = z.enum(["active", "arrears", "dormant", "exited"]);

/**
 * The canonical P12 exit-statement document (ExitStatementOut,
 * `GET /member-exits/{id}/statement`) — a financial DOCUMENT: every
 * figure and line renders VERBATIM; nothing is recomputed, summed or
 * netted client-side (equity is the SERVER's shares+deposits figure —
 * the client never re-derives it from the components). The CSV/PDF
 * export of this document ships via the reports module
 * (`member_exit_statement`, P13 blocker (k)) — no download affordance
 * is duplicated here, so no filename is ever derived from a server
 * string (the !63 F-R1 class cannot arise).
 */
export const exitStatementSchema = z.object({
  exit_id: z.string(),
  member_id: z.string(),
  member_no: z.string(),
  member_name: z.string(),
  member_status: statementMemberStatusSchema,
  exit_status: exitStatusSchema,
  reason: z.string().nullable(),
  shares_amount: moneySchema,
  deposits_amount: moneySchema,
  /** SERVER-computed equity line — never re-derived client-side. */
  equity: moneySchema,
  loan_balance: moneySchema,
  fees: moneySchema,
  net_payable: signedMoneySchema,
  requested_at: timestampSchema,
  decided_at: timestampSchema.nullable(),
  settled_at: timestampSchema.nullable(),
  settlement_txn_ref: z.string().nullable(),
});

export type ExitStatement = z.infer<typeof exitStatementSchema>;

/**
 * Client-side pre-validation of the exit-request form (the server
 * re-validates and is the enforcer — gate 1.6). NO money field exists
 * anywhere in this input: the P12 contract computes every settlement
 * figure server-side under locks and the exit fee comes exclusively
 * from tenant configuration (`extra="forbid"` server-side) — nothing
 * money-shaped can even be sent.
 */
export const exitRequestEntrySchema = z.object({
  member_id: z.string().min(1, "Select a member."),
  /** Optional free-text reason, mirroring the contract's max length. */
  reason: z.string().max(200, "Keep the reason under 200 characters."),
});

export type ExitRequestEntry = z.infer<typeof exitRequestEntrySchema>;
