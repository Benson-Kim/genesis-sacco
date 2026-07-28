'use client';

import { ModuleUnavailable, PageHeader } from '@genesis/ui';
import { RouteGuard } from '@/lib/permissions';

function Content() {
  return (
    <div>
      <PageHeader title="Statements & reports" />
      <ModuleUnavailable moduleName="Reports" prompt="docs/BUILD_PROMPTS.md P13" />
    </div>
  );
}

export default function Page() {
  return (
    <RouteGuard module="reports">
      <Content />
    </RouteGuard>
  );
}
