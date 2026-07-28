'use client';

import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { Button, EmptyState, ErrorBanner } from '@genesis/ui';
import type { ModuleName, PermissionOut, RoleOut } from '@genesis/api-client';
import { usePermission } from '@/lib/permissions';
import { useRoles } from '@/hooks/use-roles';
import { useRolePermissions, useUpdatePermission } from '@/hooks/use-role-permissions';
import { MODULE_ORDER, MODULE_LABELS, ACTION_KEYS, ACTION_LABELS, type ActionKey } from './constants';

type PermDraft = Record<ModuleName, Record<ActionKey, boolean>>;

/** Build an editable draft from the API permission array. */
function buildDraft(perms: PermissionOut[]): PermDraft {
  const draft = {} as PermDraft;
  for (const m of MODULE_ORDER) {
    const found = perms.find((p) => p.module === m);
    draft[m] = {
      can_view: found?.can_view ?? false,
      can_create: found?.can_create ?? false,
      can_edit: found?.can_edit ?? false,
      can_approve: found?.can_approve ?? false,
    };
  }
  return draft;
}

/** Returns true when any action in any module differs between draft and original. */
function hasChanges(draft: PermDraft, original: PermissionOut[]): boolean {
  for (const m of MODULE_ORDER) {
    const orig = original.find((p) => p.module === m);
    for (const key of ACTION_KEYS) {
      if ((draft[m][key]) !== (orig?.[key] ?? false)) return true;
    }
  }
  return false;
}

/** Returns only the module names whose draft differs from the original. */
function changedModules(draft: PermDraft, original: PermissionOut[]): ModuleName[] {
  const result: ModuleName[] = [];
  for (const m of MODULE_ORDER) {
    const orig = original.find((p) => p.module === m);
    for (const key of ACTION_KEYS) {
      if ((draft[m][key]) !== (orig?.[key] ?? false)) {
        result.push(m);
        break;
      }
    }
  }
  return result;
}

function CheckIcon() {
  return (
    <svg
      className="ac-check-icon"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3 7.5L5.5 10L11 4"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PermissionMatrix({
  draft,
  disabled,
  onToggle,
  roleName,
}: {
  draft: PermDraft;
  disabled: boolean;
  onToggle: (module: ModuleName, action: ActionKey) => void;
  roleName: string;
}) {
  return (
    <table className="ac-perms-table">
      <caption style={{ position: 'absolute', left: -9999 }}>
        Permissions for {roleName}
      </caption>
      <thead>
        <tr>
          <th scope="col">Module</th>
          {ACTION_LABELS.map((label) => (
            <th key={label} scope="col">{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {MODULE_ORDER.map((mod) => (
          <tr key={mod}>
            <td>{MODULE_LABELS[mod]}</td>
            {ACTION_KEYS.map((action, i) => (
              <td key={action}>
                <label className="ac-check">
                  <input
                    type="checkbox"
                    checked={draft[mod][action]}
                    disabled={disabled}
                    onChange={() => onToggle(mod, action)}
                    aria-label={`${MODULE_LABELS[mod]} — ${ACTION_LABELS[i] ?? action}`}
                  />
                  <CheckIcon />
                </label>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RoleSidebar({
  roles,
  activeRoleId,
  onSelect,
}: {
  roles: RoleOut[];
  activeRoleId: string;
  onSelect: (roleId: string) => void;
}) {
  const sidebarRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    let nextIndex = index;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = Math.min(index + 1, roles.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = Math.max(index - 1, 0);
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = roles.length - 1;
    } else {
      return;
    }
    const target = roles[nextIndex];
    if (target) {
      onSelect(target.id);
      const options = sidebarRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
      options?.[nextIndex]?.focus();
    }
  };

  return (
    <div
      className="ac-role-sidebar"
      role="listbox"
      aria-label="Roles"
      ref={sidebarRef}
    >
      {roles.map((role, idx) => (
        <div
          key={role.id}
          role="option"
          aria-selected={role.id === activeRoleId}
          tabIndex={role.id === activeRoleId ? 0 : -1}
          className="ac-role-option"
          onClick={() => onSelect(role.id)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
        >
          <span className="ac-role-radio" aria-hidden="true" />
          {role.name}
        </div>
      ))}
    </div>
  );
}

export function RolesPanel() {
  const canEdit = usePermission('access_control', 'edit');
  const { data: roles, isLoading: rolesLoading, isError: rolesError, error: rolesErr } = useRoles();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PermDraft | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rolesList = roles ?? [];
  const firstRole = rolesList[0];
  const activeRoleId = selectedRoleId ?? firstRole?.id ?? null;
  const activeRole = rolesList.find((r) => r.id === activeRoleId);

  const {
    data: perms,
    isLoading: permsLoading,
    isError: permsError,
    error: permsErr,
  } = useRolePermissions(activeRoleId);
  const mutation = useUpdatePermission();

  // Sync draft state when permissions are fetched (or when active role changes).
  useEffect(() => {
    if (perms) {
      setDraft(buildDraft(perms));
      setSavedMsg(false);
      setSaveError(null);
    }
  }, [perms]);

  const togglePerm = useCallback(
    (module: ModuleName, action: ActionKey) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [module]: {
            ...prev[module],
            [action]: !prev[module][action],
          },
        };
      });
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!draft || !perms || !activeRoleId) return;
    setSaveError(null);
    try {
      const changed = changedModules(draft, perms);
      for (const m of changed) {
        await mutation.mutateAsync({
          roleId: activeRoleId,
          module: m,
          grant: draft[m],
        });
      }
      setSavedMsg(true);
      const timer = window.setTimeout(() => setSavedMsg(false), 3000);
      return () => window.clearTimeout(timer);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save permissions. Please try again.');
    }
  }, [draft, perms, activeRoleId, mutation]);

  if (rolesLoading) return <EmptyState label="Loading roles…" />;
  if (rolesError) {
    return (
      <ErrorBanner
        message={rolesErr instanceof Error ? rolesErr.message : 'Could not load roles. Please try again.'}
      />
    );
  }
  if (rolesList.length === 0 || !activeRoleId) {
    return <EmptyState label="No roles configured for this tenant." />;
  }

  const dirty = draft && perms ? hasChanges(draft, perms) : false;

  return (
    <>
      <div className="ac-roles-layout">
        <RoleSidebar
          roles={rolesList}
          activeRoleId={activeRoleId}
          onSelect={setSelectedRoleId}
        />

        <div className="ac-perms-panel">
          <h2 className="ac-perms-title">
            Permissions — {activeRole?.name ?? '…'}
          </h2>

          {permsLoading && <EmptyState label="Loading permissions…" />}
          {permsError && (
            <ErrorBanner
              message={permsErr instanceof Error ? permsErr.message : 'Could not load permissions.'}
            />
          )}

          {draft && !permsLoading && !permsError && (
            <PermissionMatrix
              draft={draft}
              disabled={!canEdit || mutation.isPending}
              onToggle={togglePerm}
              roleName={activeRole?.name ?? ''}
            />
          )}
        </div>
      </div>

      {canEdit && draft && (
        <div className="ac-save-row">
          <Button
            variant="primary"
            disabled={!dirty || mutation.isPending}
            onClick={handleSave}
          >
            {mutation.isPending ? 'Saving…' : 'Save role'}
          </Button>
          <span
            className="ac-save-status"
            data-visible={String(savedMsg)}
            aria-live="polite"
          >
            ✓ Saved
          </span>
        </div>
      )}

      {saveError && <ErrorBanner message={saveError} />}
    </>
  );
}
