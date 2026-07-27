import type { ReactNode } from 'react';
import '@genesis/tokens';
import { Providers } from './providers';

export const metadata = {
  title: 'Genesis Prestige — Admin',
  description: 'SACCO management platform admin console',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
