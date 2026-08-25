import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { getUserMemberships } from "@/lib/projects";

export default async function HomePage() {
  const session = await auth();
  if (session?.user?.id) {
    const memberships = await getUserMemberships(session.user.id);
    if (memberships[0]) {
      redirect(`/dashboard/${memberships[0].project.id}`);
    }
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2 font-display text-[17px] font-bold tracking-tight">
          <span className="text-live" aria-hidden>
            ◈
          </span>
          Deck
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Create account</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
        <p className="font-mono text-xs tracking-widest text-live uppercase">
          self-hosted livekit
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Control room for your media infrastructure.
        </h1>
        <p className="mt-4 max-w-lg text-muted-foreground">
          Watch rooms, participants, egress jobs, and webhook history on your
          own LiveKit server — not LiveKit Cloud.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
