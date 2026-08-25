"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      title="This page failed to load"
      description={error.message || "LiveKit data or this view hit an unexpected error."}
      onRetry={reset}
    />
  );
}
