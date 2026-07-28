'use client';

import type { ReactNode } from 'react';
import { AdminShell } from '@/components/admin-shell';
import './admin-shell.css';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
