'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ModuleName } from '@genesis/api-client';
import { colors, space, fontSize, radii, sidebar } from '@genesis/tokens';
import { useAuth } from '@/lib/auth-context';
import { usePermission } from '@/lib/permissions';

const NAV_ITEMS: Array<{ href: string; label: string; module: ModuleName }> = [
  { href: '/dashboard/members', label: 'Members', module: 'members' },
  { href: '/dashboard/loan-book', label: 'Loan book', module: 'loan_book' },
  { href: '/dashboard/ledger', label: 'Ledger', module: 'transactions' },
  { href: '/dashboard/access-control', label: 'Access control', module: 'access_control' },
];

function NavItem({ href, label, module }: { href: string; label: string; module: ModuleName }) {
  const canView = usePermission(module, 'view');
  if (!canView) return null;
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: `${space[3]} ${space[5]}`,
        borderRadius: radii.md,
        color: sidebar.navText,
        fontWeight: 600,
        fontSize: fontSize.base,
        textDecoration: 'none',
      }}
    >
      {label}
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { clearSession } = useAuth();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav style={{ width: 220, background: colors.navy, padding: space[6], flexShrink: 0 }}>
        <div style={{ color: sidebar.brandText, fontWeight: 800, marginBottom: space[9] }}>Genesis Prestige</div>
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.href} {...item} />
        ))}
        <button
          onClick={clearSession}
          style={{
            marginTop: space[9],
            background: 'transparent',
            border: 'none',
            color: sidebar.navTextMuted,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: fontSize.sm,
          }}
        >
          Sign out
        </button>
      </nav>
      <main style={{ flex: 1, padding: space[9], background: colors.bg }}>{children}</main>
    </div>
  );
}
