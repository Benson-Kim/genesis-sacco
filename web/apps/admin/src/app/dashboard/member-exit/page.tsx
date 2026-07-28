'use client';

import { ModuleUnavailable, PageHeader } from '@genesis/ui';
import { RouteGuard } from '@/lib/permissions';

function Content() {
  return (
    <div>
      <PageHeader title="Member exit & settlement" />
      <ModuleUnavailable moduleName="Member exit" prompt="docs/BUILD_PROMPTS.md P12" />
    </div>
  );
}

export default function Page() {
  return (
    <RouteGuard module="members">
      <Content />
    </RouteGuard>
  );
}
