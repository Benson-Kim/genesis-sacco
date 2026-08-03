"use client";

/**
 * Shared save flow for the tenant-settings panels (P15 — one copy,
 * gate 1.1): every settings tab commits through this hook + UI pair.
 *
 * - Settings ARE the money parameters, so EVERY save is money-adjacent
 *   and flows through ConfirmDangerModal's typed confirmation (Phase B
 *   blocker (f)).
 * - One Idempotency-Key slot per panel: identical retries reuse the
 *   key, changed content rotates it (gate 1.4); mutations run with the
 *   global retry: 0 — exactly one write attempt per confirmation.
 * - Optimistic-lock 409 renders the shared ConflictBanner's explicit
 *   reload-and-re-enter flow (panels remount keyed on the fresh
 *   version; the stale submission is never replayed). Non-409 failures
 *   render the least-disclosure ErrorBanner.
 * - Async outcomes are announced via the shared LiveAnnouncer with
 *   operator-facing copy only.
 */
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { idempotencyKeyFor, type IdempotencyKeySlot } from "@genesis/api-client";
import { Button, ConfirmDangerModal } from "@genesis/design-system";
import { ConflictBanner } from "@/modules/layout/ConflictBanner";
import { ErrorBanner } from "@/modules/layout/ErrorBanner";
import { announce } from "@/modules/layout/announcer";
import { isConflict } from "@/lib/errors";
import { updateSettings, type UpdateSettingsInput } from "../api";
import type { Settings } from "../schemas";
import styles from "./Settings.module.css";

export const SETTINGS_QUERY_KEY = ["settings", "record"] as const;

export interface SettingsSaveFlow {
  save: UseMutationResult<Settings, Error, UpdateSettingsInput>;
  /** The validated body awaiting typed confirmation (null = none). */
  pendingInput: UpdateSettingsInput | null;
  /** Stage a validated body for confirmation. */
  requestSave: (input: UpdateSettingsInput) => void;
  /** Dismiss the confirmation without writing. */
  cancel: () => void;
}

export function useSettingsSaveFlow(panel: string): SettingsSaveFlow {
  const queryClient = useQueryClient();
  const [pendingInput, setPendingInput] = useState<UpdateSettingsInput | null>(null);
  const slot = useRef<IdempotencyKeySlot>({ key: null, body: null });

  const save = useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      updateSettings(
        input,
        idempotencyKeyFor(slot.current, JSON.stringify({ op: "settings-update", panel, input })),
      ),
    onSuccess: (fresh) => {
      setPendingInput(null);
      queryClient.setQueryData(SETTINGS_QUERY_KEY, fresh);
      announce("Settings saved.");
    },
    // Close the confirmation on failure so the banner is what the
    // operator sees; re-entering is a NEW confirmed intent — never an
    // auto-retry.
    onError: () => {
      setPendingInput(null);
      announce("Settings save failed.", "assertive");
    },
  });

  return {
    save,
    pendingInput,
    requestSave: (input) => setPendingInput(input),
    cancel: () => {
      if (!save.isPending) setPendingInput(null);
    },
  };
}

/**
 * Banners + submit button + typed-confirmation modal. Render INSIDE the
 * panel's <form>; the panel validates on submit and calls requestSave
 * with the parsed body.
 */
export function SettingsSaveControls({
  flow,
  mayEdit,
  buttonLabel,
  confirmTitle,
  confirmPhrase,
  children,
}: Readonly<{
  flow: SettingsSaveFlow;
  mayEdit: boolean;
  buttonLabel: string;
  confirmTitle: string;
  /** The exact phrase the operator must type (tab-specific). */
  confirmPhrase: string;
  /** Modal summary copy (operator-facing only). */
  children?: ReactNode;
}>) {
  const queryClient = useQueryClient();
  const conflict = flow.save.isError && isConflict(flow.save.error);

  return (
    <>
      {/* Explicit reload flow (one copy — gate 1.1): refetch the record;
          the panel remounts keyed on the fresh version. The stale
          submission is NEVER replayed. */}
      <ConflictBanner
        error={flow.save.error}
        onReload={() => {
          void queryClient.refetchQueries({ queryKey: SETTINGS_QUERY_KEY });
        }}
      />
      {flow.save.isError && !conflict && <ErrorBanner error={flow.save.error} />}
      {mayEdit && (
        <div className={styles.saveRow}>
          <Button variant="primary" type="submit" disabled={flow.save.isPending}>
            {flow.save.isPending ? "Saving…" : buttonLabel}
          </Button>
        </div>
      )}
      {flow.pendingInput !== null && (
        <ConfirmDangerModal
          title={confirmTitle}
          confirmPhrase={confirmPhrase}
          confirmLabel={confirmTitle}
          pending={flow.save.isPending}
          onClose={flow.cancel}
          onConfirm={() => {
            if (!flow.save.isPending && flow.pendingInput !== null) {
              flow.save.mutate(flow.pendingInput);
            }
          }}
        >
          {children}
        </ConfirmDangerModal>
      )}
    </>
  );
}
