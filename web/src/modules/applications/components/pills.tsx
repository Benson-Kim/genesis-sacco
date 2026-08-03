import type { ReactNode } from "react";
import { Pill } from "@genesis/design-system";
import { STAGE_LABELS, type ApplicationStage } from "../schemas";

/**
 * Stage + cover pills (prototype `sc()` colors). One copy for the list,
 * detail and committee screens (gate 1.1). Never color alone: the pill
 * text carries the meaning (issue #8).
 */
export function stagePill(stage: ApplicationStage): ReactNode {
  switch (stage) {
    case "rejected":
      return (
        <Pill bg="brickSoft" color="brick">
          {STAGE_LABELS.rejected}
        </Pill>
      );
    case "approved":
    case "disbursed":
      return (
        <Pill bg="emeraldSoft" color="emerald">
          {STAGE_LABELS[stage]}
        </Pill>
      );
    case "committee":
      return (
        <Pill bg="goldSoft" color="navy">
          {STAGE_LABELS.committee}
        </Pill>
      );
    default:
      return <Pill>{STAGE_LABELS[stage]}</Pill>;
  }
}

/**
 * Display threshold for the cover pill (prototype: ≥100% renders
 * emerald). PURE STRING inspection — the API's decimal string has no
 * sign and no leading zeros, so "at least 100" is exactly "the integer
 * part has 3+ digits". No numeric coercion, no arithmetic; the figure
 * itself renders verbatim (P15 blocker (a)).
 */
function coverAtLeast100(cover: string): boolean {
  const integerPart = cover.split(".")[0] ?? "";
  return /^\d{3,}$/.test(integerPart);
}

export function coverPill(coverPct: string): ReactNode {
  return coverAtLeast100(coverPct) ? (
    <Pill bg="emeraldSoft" color="emerald">
      {coverPct}%
    </Pill>
  ) : (
    <Pill bg="brickSoft" color="brick">
      {coverPct}%
    </Pill>
  );
}
