import Link from "next/link";
import { signOutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function UserMenu({ email, always = false }: { email: string; always?: boolean }) {
  return (
    <div className={cn("flex items-center gap-1", always && "flex-wrap")}>
      <span
        className={cn(
          "max-w-[160px] truncate font-mono text-xs text-muted-foreground",
          !always && "hidden sm:inline",
        )}
      >
        {email}
      </span>
      <Button
        asChild
        variant="ghost"
        size="sm"
        className={cn("text-xs", !always && "hidden sm:inline-flex")}
      >
        <Link href="/onboarding?new=1">New project</Link>
      </Button>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="sm" className="text-xs">
          Sign out
        </Button>
      </form>
    </div>
  );
}
