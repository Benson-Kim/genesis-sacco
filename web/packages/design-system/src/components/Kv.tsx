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
  /**
   * Optional extra class APPENDED to the value span's class list (#31
   * batch 11, ledger (o)): the residual raw-markup rows composed a
   * per-value module class (the audit drawer's `tnum`) that the
   * primitive could not express — this keeps their rendered class
   * sets EQUIVALENT after folding in. Callers pass CSS-module tokens
   * only; the string lands in a React-escaped class attribute (never
   * parsed as HTML), so hostile strings stay inert regardless.
   */
  valueClassName?: string;
}

/**
 * Labelled key/value detail row (the exits/loans drawer convention),
 * promoted from 28 module-local copies (#31 batch 9, drift-audit
 * DA-72.2, gate 1.1). Label and value render exclusively through React
 * text interpolation — attacker-influenced strings stay inert (no HTML
 * parsing, no React parser sink).
 */
export function Kv({
  label,
  children,
  variant = "default",
  valueClassName,
}: Readonly<KvProps>) {
  const rowClass =
    variant === "quiet" ? `${styles.kvRow} ${styles.quiet}` : styles.kvRow;
  const valClass =
    valueClassName === undefined ? styles.kvVal : `${styles.kvVal} ${valueClassName}`;
  return (
    <div className={rowClass}>
      <span className={styles.kvKey}>{label}</span>
      <span className={valClass}>{children}</span>
    </div>
  );
}
