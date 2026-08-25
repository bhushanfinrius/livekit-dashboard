import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { getUserMemberships } from "@/lib/projects";

export const metadata = {
  title: "Set up a project",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/onboarding");
  }

  const { new: isNew } = await searchParams;
  const memberships = await getUserMemberships(session.user.id);
  if (memberships.length > 0 && isNew !== "1") {
    redirect(`/dashboard/${memberships[0].project.id}`);
  }

  return (
    <AuthShell
      title={memberships.length > 0 ? "New project" : "First project"}
      subtitle="Point Deck at a LiveKit server. Generate writes keys into this repo's livekit.yaml and restarts local LiveKit, then we verify by listing rooms."
    >
      <OnboardingForm />
    </AuthShell>
  );
}
