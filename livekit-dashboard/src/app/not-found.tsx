import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-xs tracking-widest text-live uppercase">404</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        That route is not in this console. Open a project from the home page.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Back to Deck</Link>
      </Button>
    </div>
  );
}
