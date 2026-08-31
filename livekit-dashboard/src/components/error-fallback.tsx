"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PRODUCT_NAME } from "@/lib/brand";

export function ErrorFallback({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="font-display text-xl font-semibold tracking-tight">{title}</p>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {onRetry ? (
          <Button type="button" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/">Back to {PRODUCT_NAME}</Link>
        </Button>
      </div>
    </div>
  );
}
