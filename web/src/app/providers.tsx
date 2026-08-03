"use client";

import { useState, type ReactNode } from "react";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@genesis/api-client";
import { clearSession } from "@/modules/auth/session";

/**
 * TanStack Query is the only server-state mechanism (MASTER_PROMPT §2.3).
 * A 401 anywhere means the session is gone (refresh rotation failed or was
 * revoked): clear it and return to the gate.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (error instanceof ApiError && error.status === 401) {
              clearSession();
              if (typeof window !== "undefined") {
                window.location.assign("/login");
              }
            }
          },
        }),
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
