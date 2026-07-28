'use client';

import { ModuleUnavailable, PageHeader } from '@genesis/ui';
import { RouteGuard } from '@/lib/permissions';

function Content() {
  return (
    <div>
      <PageHeader title="Credit committee review" />
      <ModuleUnavailable moduleName="Credit committee" prompt="docs/BUILD_PROMPTS.md P9" />
    </div>
  );
}

export default function Page() {
  return (
    <RouteGuard module="applications">
      <Content />
    </RouteGuard>
  );
}
