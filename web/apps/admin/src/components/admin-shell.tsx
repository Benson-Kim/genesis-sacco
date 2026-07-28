'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ModuleName } from '@genesis/api-client';
import { colors, fontSize, radii, sidebar, space } from '@genesis/tokens';
import { Button } from '@genesis/ui';
import { useAuth } from '@/lib/auth-context';
import { usePermission } from '@/lib/permissions';

type NavGroup = {
  section: string;
  items: Array<{ href: string; label: string; title: string; module: ModuleName; badge?: string }>;
};

const NAV_GROUPS: NavGroup[] = [
  {
    section: 'Operations',
    items: [
      { href: '/dashboard/members', label: 'Members', title: 'Members', module: 'members' },
      { href: '/dashboard/applications', label: 'Applications', title: 'Loan applications', module: 'applications' },
      { href: '/dashboard/loan-book', label: 'Loan book', title: 'Loan book', module: 'loan_book' },
      { href: '/dashboard/guarantors', label: 'Guarantors', title: 'Guarantorship & pledges', module: 'loan_book' },
      { href: '/dashboard/ledger', label: 'Transactions', title: 'Transactions ledger', module: 'transactions' },
    ],
  },
  {
    section: 'Governance',
    items: [
      { href: '/dashboard/committee', label: 'Credit committee', title: 'Credit committee review', module: 'applications', badge: '1' },
      { href: '/dashboard/member-exit', label: 'Member exit', title: 'Member exit & settlement', module: 'members' },
    ],
  },
  {
    section: 'Insights',
    items: [{ href: '/dashboard/reports', label: 'Reports', title: 'Statements & reports', module: 'reports' }],
  },
  {
    section: 'Administration',
    items: [
      { href: '/dashboard/settings', label: 'Settings', title: 'Settings', module: 'settings' },
      { href: '/dashboard/access-control', label: 'Access control', title: 'Access control (RBAC)', module: 'access_control' },
    ],
  },
];

function initials(name: string): string {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 36,
        height: 36,
        borderRadius: radii.md,
        background: colors.navySoft,
        color: colors.navy,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        fontWeight: 800,
        fontSize: fontSize.sm,
      }}
    >
      {initials(name)}
    </span>
  );
}

function NavItem({ href, label, module, badge }: NavGroup['items'][number]) {
  const pathname = usePathname();
  const canView = usePermission(module, 'view');
  if (!canView) return null;
  const isActive = pathname === href;
  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className="gp-admin-nav-item"
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: space[4],
        padding: `${space[3]} ${space[5]}`,
        marginBottom: space[1],
        borderRadius: radii.md,
        background: isActive ? 'rgba(255,255,255,.12)' : 'transparent',
        color: isActive ? sidebar.brandText : sidebar.navText,
        fontWeight: isActive ? 800 : 600,
        fontSize: fontSize.base,
        textDecoration: 'none',
      }}
    >
      <span>{label}</span>
      {badge && (
        <span
          style={{
            marginLeft: 'auto',
            background: colors.gold,
            color: colors.navy,
            fontSize: fontSize['2xs'],
            fontWeight: 800,
            borderRadius: radii.pill,
            padding: `1px ${space[2]}`,
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

function currentTitle(pathname: string): string {
  return NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === pathname)?.title ?? 'Portfolio overview';
}

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { clearSession } = useAuth();

  return (
    <div className="gp-admin-shell" style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: colors.bg, color: colors.ink }}>
      <aside
        className="gp-admin-sidebar"
        style={{
          width: 234,
          background: colors.navy,
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          overflowY: 'auto',
        }}
      >
        <div className="gp-admin-brand" style={{ padding: `${space[8]} 18px`, display: 'flex', alignItems: 'center', gap: 11 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: radii.md,
              background: colors.gold,
              color: colors.navy,
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: fontSize['2xl'],
            }}
          >
            G
          </div>
          <div>
            <div style={{ color: sidebar.brandText, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: fontSize.lg, lineHeight: 1.1 }}>
              Genesis Prestige
            </div>
            <div style={{ color: colors.goldSoft, fontSize: fontSize['2xs'], fontWeight: 600, letterSpacing: 1 }}>
              ZURI GENESIS · SACCO
            </div>
          </div>
        </div>

        <nav className="gp-admin-nav" style={{ padding: `${space[1]} ${space[5]}`, flex: 1 }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.section}>
              <div
                className="gp-admin-section"
                style={{
                  fontSize: fontSize['2xs'],
                  fontWeight: 800,
                  color: 'rgba(255,255,255,.4)',
                  textTransform: 'uppercase',
                  letterSpacing: '.7px',
                  padding: `${space[4]} ${space[5]} ${space[2]}`,
                }}
              >
                {group.section}
              </div>
              {group.items.map((item) => <NavItem key={item.href} {...item} />)}
            </div>
          ))}
        </nav>

        <div className="gp-admin-who" style={{ padding: space[5], borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', alignItems: 'center', gap: space[4] }}>
          <Avatar name="Antony Maina" />
          <div style={{ flex: 1 }}>
            <div style={{ color: sidebar.brandText, fontSize: fontSize.sm, fontWeight: 700 }}>Antony Maina</div>
            <div style={{ color: colors.goldSoft, fontSize: fontSize['2xs'] }}>Loan officer</div>
          </div>
        </div>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header
          className="gp-admin-header"
          style={{
            height: 62,
            background: colors.card,
            borderBottom: `1px solid ${colors.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `0 ${space[9]}`,
            flexShrink: 0,
          }}
        >
          <div>
            <div className="gp-admin-title" style={{ fontSize: 17, fontWeight: 800 }}>{currentTitle(pathname)}</div>
            <div style={{ fontSize: 11.5, color: colors.sub }}>Genesis Prestige Sacco · FY2026</div>
          </div>
          <Button className="gp-admin-user" variant="secondary" onClick={clearSession} style={{ display: 'flex', alignItems: 'center', gap: space[3], padding: `${space[2]} ${space[5]}` }}>
            <Avatar name="Antony Maina" /> Maina
          </Button>
        </header>
        <main className="gp-admin-content" style={{ flex: 1, overflowY: 'auto', padding: space[9] }}>{children}</main>
      </div>
    </div>
  );
}
