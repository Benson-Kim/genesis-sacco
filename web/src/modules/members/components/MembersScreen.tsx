"use client";

/**
 * P15 members module (P8 API): keyset member register with segmented
 * status/type filters and permission-gated registration.
 *
 * - UI affordances follow the P4 matrix via /me/permissions — pure UX;
 *   the server enforces every call (gate 1.6). The register button is
 *   NOT rendered without can(create) — the UI never offers what the API
 *   forbids.
 * - Keyset pagination only (opaque cursors — gate 1.3).
 * - Every rendered string (names, emails, phones) is attacker-influenced
 *   data and renders exclusively through React text interpolation.
 */
import { useState } from "react";
import { Banner, Button, Card, Pill } from "@genesis/design-system";
import { KeysetTable, type Column } from "@/modules/table/KeysetTable";
import { useKeysetList } from "@/modules/table/useKeysetList";
import { usePermissions } from "@/modules/authz/usePermissions";
import { can } from "@/modules/authz/schemas";
import { initials } from "@/lib/format";
import { fetchMembersPage, type MemberListFilters } from "../api";
import {
    MEMBER_STATUSES,
    MEMBER_TYPES,
    STATUS_LABELS,
    TYPE_LABELS,
    type Member,
    type MemberStatus,
    type MemberType,
} from "../schemas";
import { MemberCreateDrawer } from "./MemberCreateDrawer";
import styles from "./Members.module.css";

function statusPill(status: MemberStatus) {
    switch (status) {
        case "active":
            return (
                <Pill bg="emeraldSoft" color="emerald">
                    {STATUS_LABELS.active}
                </Pill>
            );
        case "arrears":
            return (
                <Pill bg="orangeSoft" color="orange">
                    {STATUS_LABELS.arrears}
                </Pill>
            );
        case "dormant":
            return (
                <Pill bg="goldSoft" color="navy">
                    {STATUS_LABELS.dormant}
                </Pill>
            );
        case "exited":
            return (
                <Pill bg="brickSoft" color="brick">
                    {STATUS_LABELS.exited}
                </Pill>
            );
    }
}

const COLUMNS: Column<Member>[] = [
    {
        key: "member",
        header: "Member",
        render: (member) => (
            <div className={styles.userCell}>
                <div className={styles.avatar} aria-hidden>
                    {initials(member.name)}
                </div>
                <div>
                    <div className={styles.cellStrong}>{member.name}</div>
                    <div className={styles.cellSub}>{member.member_no}</div>
                </div>
            </div>
        ),
    },
    {
        key: "type",
        header: "Type",
        render: (member) => <Pill>{TYPE_LABELS[member.type]}</Pill>,
    },
    {
        key: "contact",
        header: "Contact",
        render: (member) => (
            <div>
                <div>{member.phone ?? "—"}</div>
                <div className={styles.cellSub}>{member.email ?? "—"}</div>
            </div>
        ),
    },
    {
        key: "status",
        header: "Status",
        align: "right",
        render: (member) => statusPill(member.status),
    },
];

function SegmentedFilter<T extends string>({
    label,
    options,
    labels,
    value,
    onChange,
}: Readonly<{
    label: string;
    options: readonly T[];
    labels: Record<T, string>;
    value: T | "";
    onChange: (next: T | "") => void;
}>) {
    return (
        <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>{label}</span>
            <div className={styles.segment} role="group" aria-label={label}>
                <button
                    type="button"
                    className={styles.segmentButton}
                    aria-pressed={value === ""}
                    onClick={() => onChange("")}
                >
                    All
                </button>
                {options.map((option) => (
                    <button
                        key={option}
                        type="button"
                        className={styles.segmentButton}
                        aria-pressed={value === option}
                        onClick={() => onChange(option)}
                    >
                        {labels[option]}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function MembersScreen() {
    const permissions = usePermissions();
    const [status, setStatus] = useState<MemberStatus | "">("");
    const [type, setType] = useState<MemberType | "">("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [createdNo, setCreatedNo] = useState<string | null>(null);

    const filters: MemberListFilters = { status, type };
    const list = useKeysetList<Member>({
        queryKey: ["members", "list", filters],
        fetchPage: (cursor) => fetchMembersPage(filters, cursor),
    });

    const mayCreate = can(permissions.data, "members", "create");

    return (
        <div>
            <div className={styles.toolbar}>
                <div className={styles.filters}>
                    <SegmentedFilter
                        label="Status"
                        options={MEMBER_STATUSES}
                        labels={STATUS_LABELS}
                        value={status}
                        onChange={setStatus}
                    />
                    <SegmentedFilter
                        label="Type"
                        options={MEMBER_TYPES}
                        labels={TYPE_LABELS}
                        value={type}
                        onChange={setType}
                    />
                </div>
                {mayCreate && (
                    <Button variant="primary" onClick={() => setDrawerOpen(true)}>
                        Register member
                    </Button>
                )}
            </div>
            {createdNo !== null && (
                <Banner variant="ok">Member {createdNo} registered.</Banner>
            )}
            <Card padded={false}>
                <KeysetTable
                    columns={COLUMNS}
                    query={list}
                    rowKey={(member) => member.id}
                    emptyMessage="No members match these filters."
                />
            </Card>
            {drawerOpen && (
                <MemberCreateDrawer
                    onClose={() => setDrawerOpen(false)}
                    onCreated={(member) => {
                        setDrawerOpen(false);
                        setCreatedNo(member.member_no);
                    }}
                />
            )}
        </div>
    );
}

