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
      subtitle="Point LumiVoice at this machine's LiveKit. The form is pre-filled from livekit.yaml — create the project with those keys. Generating a new pair is optional and only works when LumiVoice runs on the host."
    >
      <OnboardingForm />
    </AuthShell>
  );
}
