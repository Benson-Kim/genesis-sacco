import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { colors, radii, space, fontSize, shadow, statusToneColors, type StatusTone } from '@genesis/tokens';

function cardRadius(padding: keyof typeof space): string {
  if (padding === 9 || padding === 8) return radii.xl;
  if (padding === 7 || padding === 6) return radii.lg;
  return radii.md;
}

/** Card — prototype surface with radius tuned to the amount of inner whitespace. */
export function Card({
  children,
  style,
  padding = 8,
  tone = 'default',
  ...rest
}: HTMLAttributes<HTMLDivElement> & { padding?: keyof typeof space; tone?: 'default' | 'flat' | 'hero' }) {
  const isHero = tone === 'hero';
  return (
    <div
      {...rest}
      style={{
        background: isHero ? colors.navy : colors.card,
        color: isHero ? colors.card : colors.ink,
        border: tone === 'flat' || isHero ? 'none' : `1px solid ${colors.line}`,
        borderRadius: cardRadius(padding),
        boxShadow: tone === 'default' ? shadow.md : 'none',
        padding: space[padding],
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success';

const VARIANT_STYLE: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.navy, fg: '#fff', border: colors.navy },
  secondary: { bg: colors.card, fg: colors.sub, border: colors.line },
  danger: { bg: colors.brick, fg: '#fff', border: colors.brick },
  success: { bg: colors.emerald, fg: '#fff', border: colors.emerald },
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
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        opacity: rest.disabled ? 0.62 : 1,
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
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, eyebrow, actions }: { title: string; eyebrow?: string; actions?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[7],
        marginBottom: space[8],
      }}
    >
      <div>
        {eyebrow && <div style={{ color: colors.sub, fontSize: fontSize.sm, fontWeight: 700 }}>{eyebrow}</div>}
        <h1 style={{ fontSize: fontSize['3xl'], color: colors.ink, margin: 0 }}>{title}</h1>
      </div>
      {actions}
    </div>
  );
}

export function EmptyState({ label, detail, action }: { label: string; detail?: string; action?: ReactNode }) {
  return (
    <div
      style={{
        padding: space[9],
        textAlign: 'center',
        color: colors.sub,
        fontSize: fontSize.base,
      }}
    >
      <div style={{ color: colors.ink, fontWeight: 800, marginBottom: space[2] }}>{label}</div>
      {detail && <div style={{ maxWidth: 520, margin: '0 auto' }}>{detail}</div>}
      {action && <div style={{ marginTop: space[7] }}>{action}</div>}
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

export function MetricCard({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <Card padding={7}>
      <div style={{ color: colors.sub, fontSize: fontSize.sm, fontWeight: 700 }}>{label}</div>
      <div style={{ color: colors.ink, fontSize: fontSize['2xl'], fontWeight: 800, marginTop: space[2] }}>{value}</div>
      {detail && <div style={{ color: colors.sub, fontSize: fontSize.sm, marginTop: space[2] }}>{detail}</div>}
    </Card>
  );
}

export function ModuleUnavailable({ moduleName, prompt }: { moduleName: string; prompt: string }) {
  return (
    <Card padding={9} tone="flat">
      <EmptyState
        label={`${moduleName} API is not available yet`}
        detail={`This view intentionally does not fabricate SACCO data. It will render records from the backend once ${prompt} ships and the OpenAPI client is regenerated.`}
      />
    </Card>
  );
}
