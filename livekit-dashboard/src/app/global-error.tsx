"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0d12] text-[#e6eaf0] antialiased">
        <ErrorFallback
          title="Deck failed to start"
          description={error.message || "Reload the console and try again."}
          onRetry={reset}
        />
      </body>
    </html>
  );
}
