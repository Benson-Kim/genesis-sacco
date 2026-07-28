'use client';

import { ModuleUnavailable, PageHeader } from '@genesis/ui';
import { RouteGuard } from '@/lib/permissions';

function Content() {
  return (
    <div>
      <PageHeader title="Loan applications" />
      <ModuleUnavailable moduleName="Applications" prompt="docs/BUILD_PROMPTS.md P9" />
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
