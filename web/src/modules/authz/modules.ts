/**
 * RBAC module identifiers
 */
export const MODULES = [
  "members",
  "applications",
  "loan_book",
  "transactions",
  "reports",
  "settings",
  "access_control",
  "corrections",
] as const;


export type ModuleId = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleId, string> = {
  members: "Members",
  applications: "Applications",
  loan_book: "Loan book",
  transactions: "Transactions",
  reports: "Reports",
  settings: "Settings",
  access_control: "Access control",
  corrections: "Corrections",
};

export function isModuleId(value: string): value is ModuleId {
  return (MODULES as readonly string[]).includes(value);
}
