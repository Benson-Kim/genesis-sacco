import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { colors, radii, space, fontSize, shadow, statusToneColors, type StatusTone } from '@genesis/tokens';

/** Card — the prototype's white panel-on-bg surface. */
export function Card({ children, style, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        background: colors.card,
        border: `1px solid ${colors.line}`,
        borderRadius: radii.lg,
        boxShadow: shadow.md,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

const VARIANT_STYLE: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.navy, fg: '#fff', border: colors.navy },
  secondary: { bg: colors.card, fg: colors.sub, border: colors.line },
  danger: { bg: colors.brick, fg: '#fff', border: colors.brick },
};

export function Button({
  variant = 'secondary',
  children,
  style,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const v = VARIANT_STYLE[variant];
  return (
    <button
      {...rest}
      style={{
        border: `1.5px solid ${v.border}`,
        background: v.bg,
        color: v.fg,
        borderRadius: radii.md,
        padding: `${space[3]} ${space[7]}`,
        fontWeight: 800,
        fontSize: fontSize.base,
        cursor: 'pointer',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** StatusPill — classification/status badge (Normal/Watch/Substandard/... , Approved/Rejected). */
export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const c = statusToneColors[tone];
  return (
    <span
      style={{
        display: 'inline-block',
        color: c.fg,
        background: c.bg,
        borderRadius: radii.pill,
        padding: `${space[1]} ${space[5]}`,
        fontWeight: 700,
        fontSize: fontSize.sm,
      }}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: space[8],
      }}
    >
      <h1 style={{ fontSize: fontSize['3xl'], color: colors.ink, margin: 0 }}>{title}</h1>
      {actions}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        padding: space[9],
        textAlign: 'center',
        color: colors.sub,
        fontSize: fontSize.base,
      }}
    >
      {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{
        background: colors.brickSoft,
        color: colors.brick,
        border: `1px solid ${colors.brick}`,
        borderRadius: radii.md,
        padding: space[6],
        fontSize: fontSize.base,
        marginBottom: space[6],
      }}
    >
      {message}
    </div>
  );
}
