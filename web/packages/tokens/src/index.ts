/**
 * Typed accessors mirroring tokens.css. Import `colors`, `radii`, `space`,
 * etc. instead of writing hex codes or px values in component code — the
 * eslint rule `@genesis/no-ad-hoc-design-values` (see packages/eslint-plugin
 * config in apps/admin) flags raw hex/px literals in view files (gate 1.1).
 */
import './tokens.css';

export const colors = {
  navy: 'var(--navy)',
  navyMid: 'var(--navy-mid)',
  steel: 'var(--steel)',
  navySoft: 'var(--navy-soft)',
  gold: 'var(--gold)',
  goldSoft: 'var(--gold-soft)',
  ink: 'var(--ink)',
  sub: 'var(--sub)',
  line: 'var(--line)',
  bg: 'var(--bg)',
  panel: 'var(--panel)',
  card: 'var(--card)',
  emerald: 'var(--emerald)',
  emeraldSoft: 'var(--emerald-soft)',
  brick: 'var(--brick)',
  brickSoft: 'var(--brick-soft)',
  orange: 'var(--orange)',
  orangeSoft: 'var(--orange-soft)',
  loss: 'var(--loss)',
} as const;

export const radii = {
  xs: 'var(--radius-xs)',
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
  xl: 'var(--radius-xl)',
  pill: 'var(--radius-pill)',
} as const;

export const space = {
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  7: 'var(--space-7)',
  8: 'var(--space-8)',
  9: 'var(--space-9)',
} as const;

export const fontSize = {
  '2xs': 'var(--font-size-2xs)',
  xs: 'var(--font-size-xs)',
  sm: 'var(--font-size-sm)',
  base: 'var(--font-size-base)',
  md: 'var(--font-size-md)',
  lg: 'var(--font-size-lg)',
  xl: 'var(--font-size-xl)',
  '2xl': 'var(--font-size-2xl)',
  '3xl': 'var(--font-size-3xl)',
} as const;

export const shadow = {
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
} as const;

/**
 * Classification / status -> token mapping, mirroring the prototype's
 * pill colors (Normal/Watch/Substandard/Doubtful/Loss, Approved/Rejected).
 * Single source of truth for status color so no view re-derives it (1.1).
 */
export const sidebar = {
  brandText: '#ffffff',
  navText: 'rgba(255,255,255,.72)',
  navTextMuted: 'rgba(255,255,255,.6)',
} as const;

export type StatusTone = 'good' | 'watch' | 'bad' | 'loss' | 'neutral';

export const statusToneColors: Record<StatusTone, { fg: string; bg: string }> = {
  good: { fg: colors.emerald, bg: colors.emeraldSoft },
  watch: { fg: colors.orange, bg: colors.orangeSoft },
  bad: { fg: colors.brick, bg: colors.brickSoft },
  loss: { fg: colors.loss, bg: colors.brickSoft },
  neutral: { fg: colors.sub, bg: colors.panel },
};
