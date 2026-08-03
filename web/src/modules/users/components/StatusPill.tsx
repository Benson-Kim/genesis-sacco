import { Pill } from "@genesis/design-system";

/**
 * User-status pill (extracted from UsersScreen — review finding F-A3:
 * breaks the UsersScreen ↔ UserDetailDrawer import cycle; gate 1.1 one
 * copy). Unknown statuses render as an inert text Pill (no sink).
 */
export function statusPill(status: string) {
  if (status === "active") {
    return (
      <Pill bg="emeraldSoft" color="emerald">
        Active
      </Pill>
    );
  }
  if (status === "suspended") {
    return (
      <Pill bg="brickSoft" color="brick">
        Suspended
      </Pill>
    );
  }
  return <Pill>{status}</Pill>;
}
