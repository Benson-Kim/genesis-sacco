"use client";

import { Banner } from "@genesis/design-system";
import { operatorMessage } from "@/lib/errors";
import styles from "./ErrorBanner.module.css";

/**
 * Shared least-disclosure error banner (salvaged from the P13.5 frontend
 * branch): sanitized per-status title plus the correlation id — never
 * figures, balances or server internals (gate 1.6). Everything renders
 * as React text nodes, so attacker-influenced strings stay inert.
 */
export function ErrorBanner({ error }: Readonly<{ error: unknown }>) {
    const { title, correlationId } = operatorMessage(error);
    return (
        <Banner variant="error">
            {title}
            {correlationId !== null && correlationId !== "" && (
                < span className={styles.cid}>ref: {correlationId}</span>
            )
            }
        </Banner >
    );
}
