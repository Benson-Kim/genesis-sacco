import type { ReactNode } from "react";
import { Pill } from "@genesis/design-system";
import { TRANSFER_STATUS_LABELS, type TransferStatus } from "../schemas";

/**
 * Share-transfer workflow status pill (issue #31 (l)/(m)). One copy
 * for the register and the drawer (gate 1.1). Never color alone: the
 * pill text carries the meaning (issue #8).
 */
export function transferStatusPill(status: TransferStatus): ReactNode {
  switch (status) {
    case "pending":
      return (
        <Pill bg="goldSoft" color="navy">
          {TRANSFER_STATUS_LABELS.pending}
        </Pill>
      );
    case "posted":
      return (
        <Pill bg="emeraldSoft" color="emerald">
          {TRANSFER_STATUS_LABELS.posted}
        </Pill>
      );
    case "rejected":
      return (
        <Pill bg="brickSoft" color="brick">
          {TRANSFER_STATUS_LABELS.rejected}
        </Pill>
      );
  }
}
