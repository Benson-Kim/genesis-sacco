/**
  * Pure formatting helpers (no DOM, no I/O — testable), salvaged from the
  * P13.5 frontend branch (duo/feature/p13-5-frontend-followthrough).
  *
  * MONEY RULE (P15 blocker (a), MASTER_PROMPT §0): amounts arrive from the
  * API as decimal STRINGS and are rendered by string manipulation only.
  * There is NO parseFloat/Number conversion and NO arithmetic on money
  * values anywhere in the client — the ledger is the single source of
  * truth and every derived figure is server-computed. The no-money-math
  * grep gate (src/__tests__/no-money-math.test.ts) enforces this.
  */

const AMOUNT_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Group an API decimal string with thousands separators — pure string
 * transformation, no numeric conversion. Unexpected shapes render
 * verbatim (as inert React text) rather than being coerced.
 */
export function fmtAmount(value: string): string {
    const match = AMOUNT_RE.exec(value.trim());
    if (match === null) return value;
    const [, sign, integer, fraction] = match;
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}${grouped}${fraction !== undefined ? `.${fraction}` : ""}`;
}

/** KES-labelled amount for stat cards and table cells. */
export function fmtKes(value: string): string {
    return `KES ${fmtAmount(value)}`;
}

/**
 * Human-readable timestamp from an ISO string; falls back to the raw
 * string (rendered as inert text by React) when unparseable.
 */
export function fmtDateTime(iso: string | null | undefined): string {
    if (iso === null || iso === undefined || iso === "") return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return new Intl.DateTimeFormat("en-KE", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(d);
}

/** Uppercase initials for the prototype avatar chip (pure text). */
export function initials(name: string): string {
    const parts = name.split(" ").filter((part) => part !== "");
    const chars = parts
        .map((part) => part.charAt(0))
        .join("")
        .slice(0, 2)
        .toUpperCase();
    return chars === "" ? "·" : chars;
}