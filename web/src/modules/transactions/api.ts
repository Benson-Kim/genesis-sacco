/**
 * Transactions API layer (P15 module 6 — P11 API) over the GENERATED
 * client.
 *
 * - Keyset pagination ONLY: opaque `cursor` echoed back verbatim; no
 *   offset or page parameters exist here (gate 1.3). Filters (member,
 *   type, channel, direction, exact ref, date range) are SERVER query
 *   parameters — the client never filters locally.
 * - Every mutation takes a caller-supplied Idempotency-Key following
 *   the stability/rotation contract (gate 1.4). None of the P11 teller
 *   writes carries a version field: the server serialises them under
 *   the member's account row lock; an exited member or an insufficient
 *   available balance surfaces as 409. A 409 is rendered via the
 *   explicit reload-and-re-enter flow, never replayed.
 * - Ids travel as path parameters serialized by the generated client;
 *   tokens and PII never enter URLs (gate 1.6, tested).
 * - MONEY (blocker (a)): the amount is a decimal STRING on the wire;
 *   every response figure (amount, balance_after, total_interest) is a
 *   server-computed decimal string asserted by the Zod boundary
 *   (numbers are REJECTED).
 */
import { toApiError } from "@genesis/api-client";
import { keysetPageSchema, type KeysetPage } from "@/modules/table/schemas";
import { api } from "@/lib/api";
import {
  accountTxnSchema,
  interestRunSchema,
  transactionSchema,
  type AccountTxn,
  type CashChannel,
  type Channel,
  type InterestRun,
  type Side,
  type Transaction,
  type TxnType,
  type TxnWriteKind,
} from "./schemas";

export const TXNS_PAGE_SIZE = 20;

const transactionPageSchema = keysetPageSchema(transactionSchema);

export interface TxnListFilters {
  member_id: string;
  type: TxnType | "";
  channel: Channel | "";
  direction: Side | "";
  /** Exact txn_ref match (the P11 contract's `ref` filter). */
  ref: string;
  /** ISO dates (YYYY-MM-DD); the server treats date_to as inclusive. */
  date_from: string;
  date_to: string;
}

export const EMPTY_TXN_FILTERS: TxnListFilters = {
  member_id: "",
  type: "",
  channel: "",
  direction: "",
  ref: "",
  date_from: "",
  date_to: "",
};

export async function fetchTransactionsPage(
  filters: TxnListFilters,
  cursor: string | null,
): Promise<KeysetPage<Transaction>> {
  const { data, error, response } = await api.GET("/transactions", {
    params: {
      query: {
        cursor: cursor ?? undefined,
        limit: TXNS_PAGE_SIZE,
        member_id: filters.member_id === "" ? undefined : filters.member_id,
        type: filters.type === "" ? undefined : filters.type,
        channel: filters.channel === "" ? undefined : filters.channel,
        direction: filters.direction === "" ? undefined : filters.direction,
        ref: filters.ref === "" ? undefined : filters.ref,
        date_from: filters.date_from === "" ? undefined : filters.date_from,
        date_to: filters.date_to === "" ? undefined : filters.date_to,
      },
    },
  });
  if (error !== undefined || data === undefined) throw toApiError(error, response);
  return transactionPageSchema.parse(data);
}

/** The wire body of every P11 teller write: the typed decimal STRING
 * and the cash channel — nothing else exists in this contract
 * (extra="forbid" server-side; the posting date is server-resolved). */
export interface MoneyWireBody {
  amount: string;
  channel: CashChannel;
}

/**
 * Record a member deposit (transactions:create). The amount travels as
 * the typed decimal STRING; the server posts it under the member's
 * deposit-account row lock and returns the balance after, verbatim.
 */
export async function postDeposit(
  memberId: string,
  body: MoneyWireBody,
  idempotencyKey: string,
): Promise<AccountTxn> {
  const { data, error, response } = await api.POST("/members/{member_id}/deposits", {
    params: { path: { member_id: memberId } },
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (error !== undefined || data === undefined) throw toApiError(error, response);
  return accountTxnSchema.parse(data);
}

/**
 * Record a member withdrawal (transactions:create). The server checks
 * the available balance under the account row lock — capacity excludes
 * live guarantee pledges — and 409s an overdraw; this client NEVER
 * pre-computes capacity (blocker (a)).
 */
export async function postWithdrawal(
  memberId: string,
  body: MoneyWireBody,
  idempotencyKey: string,
): Promise<AccountTxn> {
  const { data, error, response } = await api.POST("/members/{member_id}/withdrawals", {
    params: { path: { member_id: memberId } },
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (error !== undefined || data === undefined) throw toApiError(error, response);
  return accountTxnSchema.parse(data);
}

/** Record a share top-up (transactions:create; SH- ref). */
export async function postShareTopup(
  memberId: string,
  body: MoneyWireBody,
  idempotencyKey: string,
): Promise<AccountTxn> {
  const { data, error, response } = await api.POST("/members/{member_id}/share-topups", {
    params: { path: { member_id: memberId } },
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (error !== undefined || data === undefined) throw toApiError(error, response);
  return accountTxnSchema.parse(data);
}

/** One dispatcher used by the post-transaction drawer — each kind maps
 * to its own generated-client route (static path literals). */
export function postMoneyWrite(
  kind: TxnWriteKind,
  memberId: string,
  body: MoneyWireBody,
  idempotencyKey: string,
): Promise<AccountTxn> {
  switch (kind) {
    case "deposit":
      return postDeposit(memberId, body, idempotencyKey);
    case "withdrawal":
      return postWithdrawal(memberId, body, idempotencyKey);
    case "share_topup":
      return postShareTopup(memberId, body, idempotencyKey);
  }
}

/**
 * Run the quarterly deposit-interest accrual for the next unaccrued
 * quarter (transactions:edit — the P11 operations catch-up route). The
 * body is EMPTY on purpose: the rate comes exclusively from tenant
 * configuration and the period is resolved server-side in strict
 * quarter order (v1.1 rule 1) — this client sends no batch size, no
 * rate, no period. An unconfigured rate surfaces as 409.
 */
export async function runDepositInterest(idempotencyKey: string): Promise<InterestRun> {
  const { data, error, response } = await api.POST("/jobs/deposit-interest", {
    body: {},
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (error !== undefined || data === undefined) throw toApiError(error, response);
  return interestRunSchema.parse(data);
}
