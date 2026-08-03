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
