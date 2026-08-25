import { AuthShell } from "@/components/auth/auth-shell";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { SignupForm } from "@/components/auth/signup-form";
import { oauthEnabled } from "@/lib/env";

export const metadata = {
  title: "Create account",
};

export default function SignupPage() {
  const oauth = oauthEnabled();

  return (
    <AuthShell
      title="Create account"
      subtitle="Email and password are stored in your Postgres — hashed with bcrypt."
    >
      <SignupForm />
      <div className="mt-6">
        <OAuthButtons github={oauth.github} google={oauth.google} />
      </div>
    </AuthShell>
  );
}
