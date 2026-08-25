"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      title="Something went wrong"
      description={error.message || "The console hit an unexpected error."}
      onRetry={reset}
    />
  );
}
