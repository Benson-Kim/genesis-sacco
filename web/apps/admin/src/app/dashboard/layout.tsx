'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { ModuleName } from '@genesis/api-client';
import { space, fontSize, radii, sidebar } from '@genesis/tokens';
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
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  if (!canView) return null;

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        // 44px minimum tap target (Fitts's law) — matches Button.
        minHeight: 44,
        padding: `${space[3]} ${space[5]}`,
        borderRadius: radii.md,
        // The active route gets a filled background, not just a color
        // change, so it reads at a glance (recognition over recall) and
        // still passes contrast for low-vision users.
        background: isActive ? 'rgba(255,255,255,.14)' : 'transparent',
        color: isActive ? sidebar.brandText : sidebar.navText,
        fontWeight: 600,
        fontSize: fontSize.base,
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Link>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { clearSession } = useAuth();

  return (
    <>
      <a href="#main-content" className="gp-skip-link">
        Skip to main content
      </a>
      <div className="gp-dashboard-shell">
        <nav className="gp-dashboard-nav" aria-label="Main">
          <div style={{ color: sidebar.brandText, fontWeight: 800, marginBottom: space[9] }}>
            Genesis Prestige
          </div>
          <div className="gp-dashboard-nav-items">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.href} {...item} />
            ))}
          </div>
          <button
            onClick={clearSession}
            style={{
              marginTop: space[9],
              minHeight: 44,
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
        {/* tabIndex=-1 lets the skip link move focus here programmatically
            without adding this container to the normal Tab order. */}
        <main id="main-content" className="gp-dashboard-main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </>
  );
}
