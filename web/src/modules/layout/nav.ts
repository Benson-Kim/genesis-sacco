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
 * without their own RBAC module (guarantors, committee, member exit,
 * recovery) live under their owning modules.
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
      {
        label: "Credit committee",
        href: "/modules/applications/committee",
        module: "applications",
        icon: "committee",
      },
      {
        label: "Member exit",
        href: "/modules/members/exits",
        module: "members",
        icon: "exit",
      },
      {
        // P13.15 corrections console (issue #31 batch 1 — audit #30
        // R1): the fraud channel's DEDICATED corrections RBAC module,
        // never generic transactions (A3 maker-checker).
        label: "Corrections",
        href: "/modules/corrections",
        module: "corrections",
        icon: "transactions",
      },
      {
        // P13.16 recovery worklist (issue #31 batch 1 — audit #30 R1);
        // lives under the loan_book RBAC module (every /recovery-cases
        // route is gated on loan_book view/create/edit server-side —
        // there is no dedicated recovery module in the P4 matrix; the
        // member-exit-under-members precedent).
        label: "Recovery",
        href: "/modules/loan_book/recovery",
        module: "loan_book",
        icon: "loan_book",
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
