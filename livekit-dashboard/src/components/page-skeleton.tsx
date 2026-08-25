import { cn } from "@/lib/utils";

export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("space-y-4", className)}
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}

export function StatusLine({
  error,
  loading,
  loadingLabel = "Refreshing…",
}: {
  error?: string | null;
  loading?: boolean;
  loadingLabel?: string;
}) {
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {loadingLabel}
      </p>
    );
  }
  return null;
}
