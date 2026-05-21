"use client";

// Track C2. Admin route group layout — owns its own QueryClient so
// TanStack Query hooks (useClinicSettings) work independently of the
// patient-facing translator surface.

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <div className="min-h-screen bg-background text-foreground">{children}</div>
    </QueryClientProvider>
  );
}
