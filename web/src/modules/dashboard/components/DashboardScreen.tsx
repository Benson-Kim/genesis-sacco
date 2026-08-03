"use client";

/**
 * P15 dashboard — live figures from GET /dashboard/summary (P13.9/P10).
 *
 * Money rules (P15 blocker (a)): every amount below is the API's decimal
 * string rendered through the string-only formatters — the client never
 * computes, aggregates or converts a money figure. Slices the role is
 * not granted arrive omitted and render as "—" (deny-by-default, 1.6).
 */
import { useQuery } from "@tanstack/react-query";
import { Card, Stat } from "@genesis/design-system";
import { ErrorBanner } from "@/modules/layout/ErrorBanner";
import { fmtAmount, fmtDateTime, fmtKes } from "@/lib/format";
import { STALE_TIME } from "@/lib/query";
import { fetchDashboardSummary } from "../api";
import type { DashboardSummary } from "../schemas";
import grid from "@/modules/layout/grid.module.css";
import styles from "./DashboardScreen.module.css";

export const DASHBOARD_QUERY_KEY = ["dashboard", "summary"] as const;

export function useDashboardSummary() {
    return useQuery({ queryKey: DASHBOARD_QUERY_KEY, queryFn: fetchDashboardSummary });
}

// Single copy of the KES label lives in fmtKes (gate 1.1; finding F-A7).
function kes(value: string | undefined): string {
    return value === undefined ? "—" : fmtKes(value);
}

function StatCards({ summary }: Readonly<{ summary: DashboardSummary }>) {
    return (
        <>
            <Card>
                <Stat
                    label="Active members"
                    value={summary.members ? String(summary.members.active_members) : "—"}
                />
            </Card>
            <Card>
                <Stat label="Deposits" value={kes(summary.deposits?.total_deposits)} />
            </Card>
            <Card>
                <Stat label="Loan book" value={kes(summary.loan_book?.outstanding_balance)} />
            </Card>
            <Card>
                <Stat
                    label="PAR-30"
                    value={summary.loan_book ? `${summary.loan_book.par30_ratio_pct}%` : "—"}
                />
            </Card>
        </>
    );
}

function PipelineCard({ pipeline }: Readonly<{ pipeline: DashboardSummary["pipeline"] }>) {
    if (pipeline === null || pipeline === undefined) return null;
    return (
        <Card className={styles.half}>
            <h2 className={styles.title}>Application pipeline</h2>
            <ul className={styles.pipeline}>
                {pipeline.map((stage) => (
                    <li key={stage.stage} className={styles.pipelineRow}>
                        <span className={styles.stageName}>{stage.stage}</span>
                        <span className={styles.stageCount}>{stage.count}</span>
                    </li>
                ))}
                {pipeline.length === 0 && <li className={styles.muted}>No applications in flight.</li>}
            </ul>
        </Card>
    );
}

function FlowsCard({ flows }: Readonly<{ flows: DashboardSummary["monthly_flows"] }>) {
    if (flows === null || flows === undefined) return null;
    return (
        <Card className={styles.half}>
            <h2 className={styles.title}>Monthly flows</h2>
            <table className={styles.flows}>
                <thead>
                    <tr>
                        <th scope="col" className={styles.th}>
                            Month
                        </th>
                        <th scope="col" className={styles.thRight}>
                            Deposits
                        </th>
                        <th scope="col" className={styles.thRight}>
                            Disbursements
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {flows.map((flow) => (
                        <tr key={flow.month}>
                            <td className={styles.td}>{flow.month}</td>
                            <td className={styles.tdRight}>{fmtAmount(flow.deposits)}</td>
                            <td className={styles.tdRight}>{fmtAmount(flow.disbursements)}</td>
                        </tr>
                    ))}
                    {flows.length === 0 && (
                        <tr>
                            <td className={styles.muted} colSpan={3}>
                                No flows recorded yet.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </Card>
    );
}

function ClassificationCard({
    loanBook,
}: Readonly<{ loanBook: DashboardSummary["loan_book"] }>) {
    if (loanBook === null || loanBook === undefined) return null;
    return (
        <Card className={styles.wide}>
            <h2 className={styles.title}>Portfolio classification</h2>
            <table className={styles.flows}>
                <thead>
                    <tr>
                        <th scope="col" className={styles.th}>
                            Classification
                        </th>
                        <th scope="col" className={styles.thRight}>
                            Loans
                        </th>
                        <th scope="col" className={styles.thRight}>
                            Balance
                        </th>
                        <th scope="col" className={styles.thRight}>
                            Provisions
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {loanBook.by_classification.map((slice) => (
                        <tr key={slice.classification}>
                            <td className={styles.td}>{slice.classification}</td>
                            <td className={styles.tdRight}>{slice.count}</td>
                            <td className={styles.tdRight}>{fmtAmount(slice.balance)}</td>
                            <td className={styles.tdRight}>{fmtAmount(slice.provisions)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Card>
    );
}

export function DashboardScreen() {
    const summary = useDashboardSummary();

    if (summary.isPending) {
        return <div className={styles.muted}>Loading dashboard…</div>;
    }

    if (summary.isError) {
        return <ErrorBanner error={summary.error} />;
    }

    return (
        // Shared responsive grid (grid.module.css): 4 -> 2 -> 1 columns.
        <div className={grid.cards4}>
            <StatCards summary={summary.data} />
            <PipelineCard pipeline={summary.data.pipeline} />
            <FlowsCard flows={summary.data.monthly_flows} />
            <ClassificationCard loanBook={summary.data.loan_book} />
            <div className={styles.asOf}>As of {fmtDateTime(summary.data.as_of)}</div>
        </div>
    );
}

loanBook={summary.data.loan_book} />
            <div className={styles.asOf}>As of {fmtDateTime(summary.data.as_of)}</div>
        </div>
    );
}

