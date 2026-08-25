import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { oauthEnabled } from "@/lib/env";

export const metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  const oauth = oauthEnabled();

  return (
    <AuthShell
      title="Sign in"
      subtitle="Session cookies only — no LiveKit Cloud account required."
    >
      <Suspense>
        <LoginForm />
      </Suspense>
      <div className="mt-6">
        <OAuthButtons github={oauth.github} google={oauth.google} />
      </div>
    </AuthShell>
  );
}
