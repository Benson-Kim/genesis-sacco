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
 * Sidebar structure. Prototype entries without their own RBAC module
 *  (guarantors, committee, member exit) live under their owning modules.
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
        label: "Corrections",
        href: "/modules/corrections",
        module: "corrections",
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
