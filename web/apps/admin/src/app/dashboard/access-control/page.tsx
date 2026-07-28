'use client';

import { useState, type KeyboardEvent } from 'react';
import { Card } from '@genesis/ui';
import { space } from '@genesis/tokens';
import { RouteGuard } from '@/lib/permissions';
import { UsersPanel } from './users-panel';
import { RolesPanel } from './roles-panel';
import './access-control.css';

type TabId = 'users' | 'roles';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'users', label: 'Users' },
  { id: 'roles', label: 'Roles & permissions' },
] as const;

function TabBar({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (tab: TabId) => void;
}) {
  const currentIndex = TABS.findIndex((t) => t.id === active);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const direction = e.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = (currentIndex + direction + TABS.length) % TABS.length;
      const nextTab = TABS[nextIndex];
      if (nextTab) onChange(nextTab.id);
    }
  };

  return (
    <div className="ac-tabs" role="tablist" aria-label="Access control views">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          id={`tab-${tab.id}`}
          className="ac-tab"
          role="tab"
          aria-selected={active === tab.id}
          aria-controls={`tabpanel-${tab.id}`}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={handleKeyDown}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function AccessControlContent() {
  const [activeTab, setActiveTab] = useState<TabId>('users');

  return (
    <div>
      <TabBar active={activeTab} onChange={setActiveTab} />

      <Card style={{ padding: space[8] }}>
        <div
          id="tabpanel-users"
          role="tabpanel"
          aria-labelledby="tab-users"
          hidden={activeTab !== 'users'}
        >
          {activeTab === 'users' && <UsersPanel />}
        </div>

        <div
          id="tabpanel-roles"
          role="tabpanel"
          aria-labelledby="tab-roles"
          hidden={activeTab !== 'roles'}
        >
          {activeTab === 'roles' && <RolesPanel />}
        </div>
      </Card>
    </div>
  );
}

export default function AccessControlPage() {
  return (
    <RouteGuard module="access_control">
      <AccessControlContent />
    </RouteGuard>
  );
}
