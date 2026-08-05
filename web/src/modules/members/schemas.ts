import { z } from "zod";

/**
 * Zod validation for the members module (P8 API). Enums mirror the
 * backend MemberStatus/MemberType; an unknown value is a contract
 * violation and is REJECTED, never silently rendered.
 */
export const MEMBER_STATUSES = ["active", "arrears", "dormant", "exited"] as const;
export const MEMBER_TYPES = ["person", "company", "group", "vehicle"] as const;

export const memberStatusSchema = z.enum(MEMBER_STATUSES);
export const memberTypeSchema = z.enum(MEMBER_TYPES);

export type MemberStatus = z.infer<typeof memberStatusSchema>;
export type MemberType = z.infer<typeof memberTypeSchema>;

export const memberSchema = z.object({
    id: z.string(),
    member_no: z.string(),
    type: memberTypeSchema,
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    status: memberStatusSchema,
    version: z.number().int(),
});

export type Member = z.infer<typeof memberSchema>;

/**
 * Advisory financial aggregates on the single-member DETAIL read
 * (#31 batch 3). All four figures are decimal STRINGS rendered
 * verbatim: NO client-side money math ever (P15 blocker (a)), no
 * summing, no derived figures. Required, not optional, per the
 * contract: the detail read always carries the object, so a missing
 * or null aggregates is a contract violation and is REJECTED.
 */
export const memberAggregatesSchema = z.object({
    deposits_total: z.string(),
    shares_total: z.string(),
    loans_outstanding: z.string(),
    guarantees_pledged: z.string(),
});

export type MemberAggregates = z.infer<typeof memberAggregatesSchema>;

export const memberDetailSchema = memberSchema.extend({
    aggregates: memberAggregatesSchema,
});

export type MemberDetail = z.infer<typeof memberDetailSchema>;

/** Client-side pre-validation of the create form (server re-validates). */
export const memberCreateSchema = z.object({
    type: memberTypeSchema,
    name: z.string().min(1).max(200),
    phone: z.string().max(32).nullable(),
    email: z.string().email().max(254).nullable(),
});

export type MemberCreateInput = z.infer<typeof memberCreateSchema>;

export const STATUS_LABELS: Record<MemberStatus, string> = {
    active: "Active",
    arrears: "In arrears",
    dormant: "Dormant",
    exited: "Exited",
};

export const TYPE_LABELS: Record<MemberType, string> = {
    person: "Person",
    company: "Company",
    group: "Group",
    vehicle: "Vehicle",
};
