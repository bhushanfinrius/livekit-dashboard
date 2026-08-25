import { oauthSignIn } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export function OAuthButtons({
  github,
  google,
}: {
  github: boolean;
  google: boolean;
}) {
  if (!github && !google) return null;

  async function githubAction() {
    "use server";
    await oauthSignIn("github");
  }

  async function googleAction() {
    "use server";
    await oauthSignIn("google");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs tracking-wide text-muted-foreground uppercase">
          or
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      {github ? (
        <form action={githubAction}>
          <Button type="submit" variant="outline" className="w-full">
            Continue with GitHub
          </Button>
        </form>
      ) : null}
      {google ? (
        <form action={googleAction}>
          <Button type="submit" variant="outline" className="w-full">
            Continue with Google
          </Button>
        </form>
      ) : null}
    </div>
  );
}
