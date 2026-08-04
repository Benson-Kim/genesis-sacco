"use client";

/**
 * Settings screen (P15 — prototype tabs: Interest, Loan products,
 * Parameters, Approval matrix), wired to GET/PUT /settings (P13.7) and
 * the P9 products routes.
 *
 * - The settings record backs optimistic-locked edits on every tab, so
 *   its staleTime is the RECORD class (0) and panels remount keyed on
 *   the loaded version.
 * - `corrupt_keys` (stored band keys that failed read-side
 *   revalidation) surface by NAME only — the corrupt payload never
 *   reaches the client (least disclosure, P13.7 R3); names render as
 *   inert React text.
 * - Tab panels are next/dynamic chunks (Phase B speed): the products
 *   editor never loads unless its tab is opened.
 */
import { useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Banner, Card } from "@genesis/design-system";
import { ErrorBanner } from "@/modules/layout/ErrorBanner";
import { STALE_TIME } from "@/lib/query";
import { fetchSettings } from "../api";
import { SETTINGS_QUERY_KEY } from "./SettingsSaveFlow";
import styles from "./Settings.module.css";

const InterestPanel = dynamic(
  () => import("./InterestPanel").then((m) => m.InterestPanel),
  { ssr: false, loading: () => <div className={styles.panelLoading}>Loading…</div> },
);
const ParametersPanel = dynamic(
  () => import("./ParametersPanel").then((m) => m.ParametersPanel),
  { ssr: false, loading: () => <div className={styles.panelLoading}>Loading…</div> },
);
const ApprovalPanel = dynamic(
  () => import("./ApprovalPanel").then((m) => m.ApprovalPanel),
  { ssr: false, loading: () => <div className={styles.panelLoading}>Loading…</div> },
);
const ProductsScreen = dynamic(
  () => import("@/modules/products/components/ProductsScreen").then((m) => m.ProductsScreen),
  { ssr: false, loading: () => <div className={styles.panelLoading}>Loading…</div> },
);

const TABS = [
  { id: "interest", label: "Interest" },
  { id: "products", label: "Loan products" },
  { id: "parameters", label: "Parameters" },
  { id: "approval", label: "Approval matrix" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: fetchSettings,
    staleTime: STALE_TIME.record,
  });
}

export function SettingsScreen() {
  const [tab, setTab] = useState<TabId>("interest");
  const settings = useSettings();
  const tabRefs = useRef<Map<TabId, HTMLButtonElement>>(new Map());

  // Conforming ARIA tabs pattern (W57-4, issue #8): roving tabindex —
  // one tab stop for the whole tablist; Left/Right (wrapping) and
  // Home/End move BOTH selection and focus (automatic activation).
  function onTablistKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const order = TABS.map((entry) => entry.id);
    const index = order.indexOf(tab);
    let next: TabId | undefined;
    if (event.key === "ArrowRight") next = order[(index + 1) % order.length];
    else if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length];
    else if (event.key === "Home") next = order[0];
    else if (event.key === "End") next = order[order.length - 1];
    if (next !== undefined) {
      event.preventDefault();
      setTab(next);
      tabRefs.current.get(next)?.focus();
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.tabs} role="tablist" aria-label="Settings sections" onKeyDown={onTablistKeyDown}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            ref={(node) => {
              if (node !== null) tabRefs.current.set(entry.id, node);
              else tabRefs.current.delete(entry.id);
            }}
            type="button"
            role="tab"
            id={`settings-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls="settings-tabpanel"
            tabIndex={tab === entry.id ? 0 : -1}
            className={`${styles.tab}${tab === entry.id ? ` ${styles.tabActive}` : ""}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="settings-tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
      >
      {tab === "products" ? (
        <ProductsScreen />
      ) : settings.isPending ? (
        <Card>
          <div className={styles.panelLoading}>Loading…</div>
        </Card>
      ) : settings.isError || settings.data === undefined ? (
        <Card>
          <ErrorBanner error={settings.error} />
        </Card>
      ) : (
        <>
          {!settings.data.configured && (
            <Banner>
              Settings are not configured yet — consumers run on documented
              fallback defaults. Saving a tab claims the first settings
              record.
            </Banner>
          )}
          {settings.data.corrupt_keys.length > 0 && (
            <Banner variant="error">
              These stored settings failed integrity revalidation and read as
              not configured: {settings.data.corrupt_keys.join(", ")}.
              Re-save them to repair the stored value.
            </Banner>
          )}
          {tab === "interest" && (
            <InterestPanel
              key={`interest:${settings.data.version}`}
              settings={settings.data}
            />
          )}
          {tab === "parameters" && (
            <ParametersPanel
              key={`parameters:${settings.data.version}`}
              settings={settings.data}
            />
          )}
          {tab === "approval" && (
            <ApprovalPanel
              key={`approval:${settings.data.version}`}
              settings={settings.data}
            />
          )}
        </>
      )}
      </div>
    </div>
  );
}
