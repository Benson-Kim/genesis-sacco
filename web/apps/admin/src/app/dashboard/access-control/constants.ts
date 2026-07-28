import type { ModuleName } from '@genesis/api-client';

export const MODULE_LABELS: Record<ModuleName, string> = {
  members: 'Members',
  applications: 'Applications',
  loan_book: 'Loan book',
  transactions: 'Transactions',
  reports: 'Reports',
  settings: 'Settings',
  access_control: 'Access control',
};

export const MODULE_ORDER: readonly ModuleName[] = [
  'members',
  'applications',
  'loan_book',
  'transactions',
  'reports',
  'settings',
  'access_control',
] as const;

export const ACTION_KEYS = ['can_view', 'can_create', 'can_edit', 'can_approve'] as const;
export type ActionKey = (typeof ACTION_KEYS)[number];

export const ACTION_LABELS: readonly string[] = ['View', 'Create', 'Edit / Post', 'Approve'] as const;

/**
 * Extract up to two uppercase initials from a full name.
 * Falls back to '?' if the name is empty or has no alphabetic chars.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts
    .map((p) => p[0])
    .filter((ch): ch is string => ch !== undefined)
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return letters || '?';
}

/**
 * Turn an ISO timestamp into a human-readable relative label.
 * Returns an em-dash for null/undefined/empty values.
 */
export function relativeTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const parsed = new Date(isoString).getTime();
  if (Number.isNaN(parsed)) return '—';
  const diff = Date.now() - parsed;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Capitalize the first character. */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
