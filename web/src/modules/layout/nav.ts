import type { ModuleId } from "@/modules/authz/modules";
import type { NavIconShape } from "./NavIcon";

export interface NavItem {
  label: string;
  href: string;
  /** RBAC module gating visibility; null = visible to any signed-in user. */
  module: ModuleId | null;
  /** Dual-state icon: outline inactive → filled active (issue #8). */
  icon: NavIconShape;
}

export interface NavSection {
  label: string;
  items: NavItem[];
  /**
   * Bottom-anchored utility zone (issue #8): secondary/administrative
   * links pin to the sidebar footer, keeping core navigation clean.
   */
  utility?: boolean;
}

/**
 * Sidebar structure mirroring the prototype NAV. Prototype entries
 * without their own RBAC module (guarantors, committee, member exit)
 * live under their owning modules.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Operations",
    items: [
      { label: "Dashboard", href: "/dashboard", module: null, icon: "dashboard" },
      { label: "Members", href: "/modules/members", module: "members", icon: "members" },
      {
        label: "Applications",
        href: "/modules/applications",
        module: "applications",
        icon: "applications",
      },
      { label: "Loan book", href: "/modules/loan_book", module: "loan_book", icon: "loan_book" },
      {
        // Prototype Operations ▸ Guarantors; lives under the
        // applications RBAC module (P9/P13.14 guarantee routes are
        // gated on applications:edit/view server-side).
        label: "Guarantors",
        href: "/modules/applications/guarantors",
        module: "applications",
        icon: "guarantors",
      },
      {
        label: "Transactions",
        href: "/modules/transactions",
        module: "transactions",
        icon: "transactions",
      },
    ],
  },
  {
    label: "Governance",
    items: [
      // Prototype Governance ▸ Credit committee; lives under the
      // applications RBAC module (P15 module 3).
      {
        label: "Credit committee",
        href: "/modules/applications/committee",
        module: "applications",
        icon: "committee",
      },
      {
        // Prototype Governance ▸ Member exit; lives under the members
        // RBAC module (every P12 /member-exits route is gated on
        // members view/edit/approve server-side — there is no
        // dedicated exit module in the P4 matrix).
        label: "Member exit",
        href: "/modules/members/exits",
        module: "members",
        icon: "exit",
      },
      {
        // The P13.11 dividends lifecycle console (issue #31 batch 2);
        // lives under the transactions RBAC module (every /dividends
        // route is gated on transactions view/edit/approve server-side
        // — there is no dedicated dividends module in the P4 matrix).
        label: "Dividends",
        href: "/modules/transactions/dividends",
        module: "transactions",
        icon: "transactions",
      },
    ],
  },
  {
    label: "Insights",
    items: [{ label: "Reports", href: "/modules/reports", module: "reports", icon: "reports" }],
  },
  {
    label: "Administration",
    utility: true,
    items: [
      { label: "Settings", href: "/modules/settings", module: "settings", icon: "settings" },
      {
        label: "Access control",
        href: "/modules/access_control",
        module: "access_control",
        icon: "access_control",
      },
      {
        label: "Audit log",
        href: "/modules/access_control/audit-log",
        module: "access_control",
        icon: "audit_log",
      },
    ],
  },
];
