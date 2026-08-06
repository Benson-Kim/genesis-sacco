/**
 * Share-transfers API layer (issue #31 batch 6, ledger (e) — audit
 * #30 R2 remainder) over the GENERATED client.
 *
 * WHAT THE CONTRACT EXPOSES (read the router, consume exactly that):
 * `POST /members/{member_id}/share-transfers` is the ONE route
 * (backend api/dividends.py — the P13.11 share lifecycle's exit
 * path). It is gated members:approve server-side (moving member
 * equity — the P12 settlement precedent, deliberately not
 * members:edit). There is NO register/list read, NO by-id read and NO
 * version to pin (the transfer is atomic and terminal server-side:
 * both member rows locked, both balances updated, the
 * share_transfers row and the ST-OUT/ST-IN double-entry legs posted
 * in one transaction). The missing read register is RECORDED on issue
 * #31 — this layer never fakes one.
 *
 * - The mutation takes a caller-supplied Idempotency-Key following
 *   the web/README.md MATERIAL rule (gate 1.4): canonical body +
 *   reload epoch + per-success intent counter (there is no record
 *   version on this contract to fold).
 * - MONEY (blocker (a)): the amount is the operation's SUBJECT — the
 *   typed decimal STRING end-to-end, never a float; the balance check
 *   runs server-side under BOTH member row locks (a shortfall is a
 *   409 with nothing posted). Every response figure is a
 *   server-computed decimal string asserted by the Zod boundary.
 * - Ids travel as path/body parameters serialized by the generated
 *   client; bearer/tenant/idempotency secrets travel as HEADERS ONLY
 *   (gate 1.6).
 */
import { toApiError } from "@genesis/api-client";
import { api } from "@/lib/api";
import { shareTransferResultSchema, type ShareTransferResult } from "./schemas";

/**
 * Transfer share capital from one ACTIVE member to another (the exit
 * path — members:approve). The body carries the transferee and the
 * subject amount ONLY (extra="forbid" server-side); the server
 * enforces active-member, distinct-members and sufficient-balance
 * under both row locks, and posts BOTH double-entry legs atomically.
 */
export async function transferShares(
  fromMemberId: string,
  toMemberId: string,
  amount: string,
  idempotencyKey: string,
): Promise<ShareTransferResult> {
  const { data, error, response } = await api.POST("/members/{member_id}/share-transfers", {
    params: { path: { member_id: fromMemberId } },
    body: { to_member_id: toMemberId, amount },
    headers: { "Idempotency-Key": idempotencyKey },
  });
  if (error !== undefined || data === undefined) throw toApiError(error, response);
  return shareTransferResultSchema.parse(data);
}
