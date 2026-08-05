/**
   * Members API layer (P15, module 2) over the GENERATED client.
   *
   * - Keyset pagination ONLY: opaque `cursor` echoed back verbatim; no
   *   offset/page parameters exist here (gate 1.3).
   * - The create mutation takes a caller-supplied Idempotency-Key following
   *   the stability/rotation contract (gate 1.4).
   * - Ids travel as path parameters serialized by the generated client;
   *   tokens/PII never enter URLs (gate 1.6).
   */
import { toApiError } from "@genesis/api-client";
import { keysetPageSchema, type KeysetPage } from "@/modules/table/schemas";
import { api } from "@/lib/api";
import {
    memberDetailSchema,
    memberSchema,
    type Member,
    type MemberCreateInput,
    type MemberDetail,
    type MemberStatus,
    type MemberType,
} from "./schemas";

export const MEMBERS_PAGE_SIZE = 20;

const memberPageSchema = keysetPageSchema(memberSchema);

export interface MemberListFilters {
    status: MemberStatus | "";
    type: MemberType | "";
}

export async function fetchMembersPage(
    filters: MemberListFilters,
    cursor: string | null,
): Promise<KeysetPage<Member>> {
    const { data, error, response } = await api.GET("/members", {
        params: {
            query: {
                cursor: cursor ?? undefined,
                limit: MEMBERS_PAGE_SIZE,
                status: filters.status === "" ? undefined : filters.status,
                type: filters.type === "" ? undefined : filters.type,
            },
        },
    });
    if (error !== undefined || data === undefined) throw toApiError(error, response);
    return memberPageSchema.parse(data);
}

/** Single member record (used by the applications detail drawer to
 *  resolve the applicant — the P9 list carries member_id only). */
export async function fetchMember(memberId: string): Promise<Member> {
    const { data, error, response } = await api.GET("/members/{member_id}", {
        params: { path: { member_id: memberId } },
    });
    if (error !== undefined || data === undefined) throw toApiError(error, response);
    return memberSchema.parse(data);
}

/** Single-member DETAIL read (the register's KYC drawer): the same
 *  GET also carries the four advisory aggregate figures — decimal
 *  strings parsed strictly at the boundary and rendered VERBATIM
 *  (P15 blocker (a): no client-side money math, ever). Cross-module
 *  consumers that only resolve a name keep using fetchMember. */
export async function fetchMemberDetail(memberId: string): Promise<MemberDetail> {
    const { data, error, response } = await api.GET("/members/{member_id}", {
        params: { path: { member_id: memberId } },
    });
    if (error !== undefined || data === undefined) throw toApiError(error, response);
    return memberDetailSchema.parse(data);
}

export async function createMember(
    input: MemberCreateInput,
    idempotencyKey: string,
): Promise<Member> {
    const { data, error, response } = await api.POST("/members", {
        body: input,
        headers: { "Idempotency-Key": idempotencyKey },
    });
    if (error !== undefined || data === undefined) throw toApiError(error, response);
    return memberSchema.parse(data);
}
