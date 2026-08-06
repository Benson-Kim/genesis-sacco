import type { ReactNode } from "react";
import styles from "./Kv.module.css";

export interface KvProps {
  label: string;
  children: ReactNode;
  /**
   * Detail-row variants observed across the module-local copies:
   * `default` — the drawer/dialog convention (emphasised value,
   * `font-weight: 700; color: var(--ink)`); `quiet` — the users/audit
   * convention (tighter row, heavier key, unweighted/uncolored value).
   */
  variant?: "default" | "quiet";
}

/**
 * Labelled key/value detail row (the exits/loans drawer convention),
 * promoted from 28 module-local copies (#31 batch 9, drift-audit
 * DA-72.2, gate 1.1). Label and value render exclusively through React
 * text interpolation — attacker-influenced strings stay inert (no HTML
 * parsing, no `dangerouslySetInnerHTML`).
 */
export function Kv({ label, children, variant = "default" }: Readonly<KvProps>) {
  const rowClass =
    variant === "quiet" ? `${styles.kvRow} ${styles.quiet}` : styles.kvRow;
  return (
    <div className={rowClass}>
      <span className={styles.kvKey}>{label}</span>
      <span className={styles.kvVal}>{children}</span>
    </div>
  );
}
