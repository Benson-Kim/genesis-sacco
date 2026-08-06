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
import {
    ClassificationBars,
    FlowsBarChart,
    PerformingDonut,
    Sparkline,
} from "./DashboardCharts";
import grid from "@/modules/layout/grid.module.css";
import styles from "./DashboardScreen.module.css";
import charts from "./DashboardCharts.module.css";

export const DASHBOARD_QUERY_KEY = ["dashboard", "summary"] as const;

export function useDashboardSummary() {
    // Composite read model: a server-computed snapshot with a rendered
    // as_of stamp — entity-class staleTime from lib/query.ts.
    return useQuery({
        queryKey: DASHBOARD_QUERY_KEY,
        queryFn: fetchDashboardSummary,
        staleTime: STALE_TIME.composite,
    });
}

// Single copy of the KES label lives in fmtKes (gate 1.1; finding F-A7).
function kes(value: string | undefined): string {
    return value === undefined ? "—" : fmtKes(value);
}

function StatCards({ summary }: Readonly<{ summary: DashboardSummary }>) {
    // KPI sparklines (issue #32): SERVER-normalized series from the
    // charts slice — mapped to plain integer arrays here, no money
    // value is ever read. HONEST labelling: only the two series the
    // contract actually carries (monthly deposit / disbursement flows)
    // get a sparkline, on the cards they truly describe; the PAR-30
    // and member cards carry none (no honest per-KPI series exists on
    // the contract — recorded on #31's ledger, never faked).
    const flowSeries = summary.charts?.flows ?? null;
    const depositTrend = flowSeries?.months.map((m) => m.deposits_pct) ?? null;
    const disbursementTrend = flowSeries?.months.map((m) => m.disbursements_pct) ?? null;
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
                {depositTrend !== null && depositTrend.length > 1 && (
                    <>
                        <Sparkline values={depositTrend} stroke="gold" />
                        <div className={charts.sparkCaption}>monthly deposit flows</div>
                    </>
                )}
            </Card>
            <Card>
                <Stat label="Loan book" value={kes(summary.loan_book?.outstanding_balance)} />
                {disbursementTrend !== null && disbursementTrend.length > 1 && (
                    <>
                        <Sparkline values={disbursementTrend} stroke="navy" />
                        <div className={charts.sparkCaption}>monthly disbursements</div>
                    </>
                )}
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
        <Card className={grid.half}>
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

function FlowsCard({
    flows,
    chart,
}: Readonly<{
    flows: DashboardSummary["monthly_flows"];
    chart: DashboardSummary["charts"];
}>) {
    if (flows === null || flows === undefined) return null;
    const flowsChart = chart?.flows ?? null;
    return (
        <Card className={grid.half}>
            <h2 className={styles.title}>Monthly flows</h2>
            {/* Chart supplement (issue #32): server-computed geometry;
                the table below stays the accessible, signed truth. */}
            {flowsChart !== null && <FlowsBarChart flows={flowsChart} />}
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

function PortfolioQualityCard({
    chart,
}: Readonly<{ chart: DashboardSummary["charts"] }>) {
    const portfolio = chart?.portfolio ?? null;
    if (portfolio === null) return null;
    return (
        <Card className={grid.half}>
            <h2 className={styles.title}>Portfolio quality</h2>
            <PerformingDonut portfolio={portfolio} />
        </Card>
    );
}

function ClassificationCard({
    loanBook,
    chart,
}: Readonly<{
    loanBook: DashboardSummary["loan_book"];
    chart: DashboardSummary["charts"];
}>) {
    if (loanBook === null || loanBook === undefined) return null;
    const portfolio = chart?.portfolio ?? null;
    return (
        <Card className={grid.wide}>
            <h2 className={styles.title}>Portfolio classification</h2>
            {/* Progress-bar supplement (issue #32): server-computed
                shares; the table below is the figures of record. */}
            {portfolio !== null && <ClassificationBars portfolio={portfolio} />}
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
            <FlowsCard flows={summary.data.monthly_flows} chart={summary.data.charts} />
            <PortfolioQualityCard chart={summary.data.charts} />
            <ClassificationCard
                loanBook={summary.data.loan_book}
                chart={summary.data.charts}
            />
            <div className={styles.asOf}>As of {fmtDateTime(summary.data.as_of)}</div>
        </div>
    );
}
