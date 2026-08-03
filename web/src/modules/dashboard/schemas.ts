import { z } from "zod";

/**
 * Zod validation of GET /dashboard/summary (P13.9 composite endpoint).
 * Money values are decimal STRINGS end-to-end — never coerced to
 * numbers in the client (P15 blocker (a)).
 *
 * The endpoint omits (nulls) every slice the caller's role is not
 * granted — the UI renders "—" for missing slices and never fabricates
 * figures (deny-by-default, gate 1.6).
 */
export const memberTypeCountSchema = z.object({
    type: z.string(),
    total: z.number().int(),
    active: z.number().int(),
});

export const membersOverviewSchema = z.object({
    active_members: z.number().int(),
    by_type: z.array(memberTypeCountSchema),
});

export const depositTotalsSchema = z.object({
    total_deposits: z.string(),
    total_share_capital: z.string(),
});

export const classificationSliceSchema = z.object({
    classification: z.string(),
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

export const guarantorCapacitySchema = z.object({
    member_id: z.string(),
    member_no: z.string(),
    name: z.string(),
    pledged_total: z.string(),
    free_capacity: z.string(),
});

export const guarantorAggregatesSchema = z.object({
    active_guarantees: z.number().int(),
    total_pledged: z.string(),
    distinct_guarantors: z.number().int(),
    guarantors: z.array(guarantorCapacitySchema),
});

export const monthlyFlowSchema = z.object({
    month: z.string(),
    deposits: z.string(),
    disbursements: z.string(),
});

export const pipelineStageSchema = z.object({
    stage: z.string(),
    count: z.number().int(),
});

export const dashboardSummarySchema = z.object({
    as_of: z.string(),
    members: membersOverviewSchema.nullish(),
    deposits: depositTotalsSchema.nullish(),
    loan_book: portfolioSummarySchema.nullish(),
    guarantors: guarantorAggregatesSchema.nullish(),
    monthly_flows: z.array(monthlyFlowSchema).nullish(),
    pipeline: z.array(pipelineStageSchema).nullish(),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type MonthlyFlow = z.infer<typeof monthlyFlowSchema>;
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type ClassificationSlice = z.infer<typeof classificationSliceSchema>;

