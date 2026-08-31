"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ComponentProps } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WebhookUrls } from "@/components/webhooks/webhook-urls";
import { apiJson } from "@/lib/api/client";
import { clientLivekitWsUrl, livekitCliProjectAdd } from "@/lib/livekit/url";
import type { MemberSnapshot } from "@/lib/projects";

export function SettingsView({
  projectId,
  initialName,
  initialUrl,
  initialPublicUrl,
  initialApiKey,
  joinCode,
  role,
  initialMembers,
  userId,
}: {
  projectId: string;
  initialName: string;
  initialUrl: string;
  initialPublicUrl: string;
  initialApiKey: string;
  joinCode: string;
  role: string;
  initialMembers: MemberSnapshot[];
  userId: string;
}) {
  const router = useRouter();
  const isOwner = role === "owner";
  const [name, setName] = useState(initialName);
  const [livekitUrl, setLivekitUrl] = useState(initialUrl);
  const [publicLivekitUrl, setPublicLivekitUrl] = useState(initialPublicUrl);
  const [members, setMembers] = useState(initialMembers);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "owner">("member");
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MemberSnapshot | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const ownerCount = members.filter((member) => member.role === "owner").length;

  async function run(key: string, work: () => Promise<void>) {
    setPending(key);
    setError(null);
    setMessage(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-live">{message}</p> : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Project</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Name and LiveKit URL for this console. Keys live on the{" "}
          <Link href={`/dashboard/${projectId}/api-keys`} className="text-live underline-offset-4 hover:underline">
            API keys
          </Link>{" "}
          page, with copy buttons like LiveKit Cloud.
        </p>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run("project", async () => {
              const payload = await apiJson<{
                name: string;
                livekitUrl: string;
                publicLivekitUrl: string | null;
                livekitApiKey: string;
              }>(`/api/projects/${projectId}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name,
                  livekitUrl,
                  publicLivekitUrl,
                }),
              });
              setName(payload.name);
              setLivekitUrl(payload.livekitUrl);
              setPublicLivekitUrl(payload.publicLivekitUrl ?? "");
              setMessage("Project saved.");
              router.refresh();
            });
          }}
        >
          <Field
            id="name"
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!isOwner}
            required
          />
          <Field
            id="url"
            label="LiveKit URL"
            value={livekitUrl}
            onChange={(event) => setLivekitUrl(event.target.value)}
            disabled={!isOwner}
            className="font-mono"
            required
          />
          <Field
            id="public-url"
            label="Public LiveKit URL"
            value={publicLivekitUrl}
            onChange={(event) => setPublicLivekitUrl(event.target.value)}
            disabled={!isOwner}
            className="font-mono"
            placeholder="wss://calls.example.com"
          />
          <p className="-mt-1 text-xs text-muted-foreground">
            Phones and the LiveKit CLI use this <span className="font-mono">wss://</span> address.
            Browser Talk/Join always uses the LiveKit URL above (local{" "}
            <span className="font-mono">ws://127.0.0.1:7880</span>). Leave empty if you have no
            public tunnel. Docker workers still connect to{" "}
            <span className="font-mono">ws://livekit:7880</span>.
          </p>
          <CopyField label="API key" value={initialApiKey} />
          {isOwner ? (
            <Button type="submit" disabled={pending !== null}>
              {pending === "project" ? "Saving…" : "Save project"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Only owners can change project settings.</p>
          )}
        </form>
        <div className="mt-4">
          <CopyField label="Join code" value={joinCode} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Use with CLI</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Same keys as this project. Paste the API secret from project create or the API keys page —
          LumiVoice does not reveal stored secrets here.
        </p>
        <CopyField
          label="lk project add"
          multiline
          value={livekitCliProjectAdd({
            projectName: name,
            wsUrl: clientLivekitWsUrl({ livekitUrl, publicLivekitUrl }),
            apiKey: initialApiKey,
          })}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">LiveKit webhook</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          LiveKit signs posts with your API secret. LumiVoice verifies them and stores the event log.
        </p>
        <WebhookUrls projectId={projectId} />
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Team</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Invite someone who already has a LumiVoice account. New users can sign up, then join with the
          code above.
        </p>
        {isOwner ? (
          <form
            className="mb-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void run("invite", async () => {
                const payload = await apiJson<{ members: MemberSnapshot[] }>(
                  `/api/projects/${projectId}/members`,
                  {
                    method: "POST",
                    body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
                  },
                );
                setMembers(payload.members);
                setInviteEmail("");
                setMessage(`Invited ${inviteEmail}.`);
              });
            }}
          >
            <Input
              type="email"
              required
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="email@company.com"
              className="sm:flex-1"
            />
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as "member" | "owner")}
              className="native-select h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
            <Button type="submit" disabled={pending === "invite"}>
              Invite
            </Button>
          </form>
        ) : null}

        <ul className="divide-y divide-border">
          {members.map((member) => {
            const isYou = member.userId === userId;
            const lastOwner = member.role === "owner" && ownerCount <= 1;
            return (
              <li key={member.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {member.name || member.email}
                    {isYou ? <span className="text-muted-foreground"> (you)</span> : null}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && !lastOwner ? (
                    <select
                      value={member.role}
                      disabled={pending === `role:${member.userId}`}
                      onChange={(event) => {
                        const nextRole = event.target.value as "owner" | "member";
                        void run(`role:${member.userId}`, async () => {
                          const payload = await apiJson<{ members: MemberSnapshot[] }>(
                            `/api/projects/${projectId}/members/${member.userId}`,
                            { method: "PATCH", body: JSON.stringify({ role: nextRole }) },
                          );
                          setMembers(payload.members);
                          if (isYou && nextRole !== "owner") router.refresh();
                        });
                      }}
                      className="native-select h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                    >
                      <option value="owner">Owner</option>
                      <option value="member">Member</option>
                    </select>
                  ) : (
                    <Badge variant="outline" className="capitalize">
                      {member.role}
                    </Badge>
                  )}
                  {(isOwner && !isYou && !lastOwner) || (isYou && !lastOwner) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRemoveTarget(member)}
                    >
                      {isYou ? "Leave" : "Remove"}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {isOwner ? (
        <section className="rounded-lg border border-destructive/40 bg-card p-4">
          <h2 className="text-sm font-medium text-destructive">Danger zone</h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            Deletes this project, memberships, and stored webhook events. LiveKit itself is not
            touched.
          </p>
          <div className="space-y-2">
            <Label htmlFor="confirm-name">Type {name} to confirm</Label>
            <Input
              id="confirm-name"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
              className="font-mono"
            />
            <Button
              type="button"
              variant="destructive"
              disabled={confirmName !== name || pending === "delete"}
              onClick={() => setDeleteOpen(true)}
            >
              Delete project
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={removeTarget?.userId === userId ? "Leave this project?" : "Remove this member?"}
        description={
          removeTarget?.userId === userId
            ? "You will lose access until someone invites you or you join with the code."
            : `Remove ${removeTarget?.email ?? "this member"} from the project.`
        }
        confirmLabel={removeTarget?.userId === userId ? "Leave" : "Remove"}
        pending={pending === "remove"}
        onConfirm={() => {
          if (!removeTarget) return;
          const leaving = removeTarget.userId === userId;
          void run("remove", async () => {
            const payload = await apiJson<{ members?: MemberSnapshot[]; left?: boolean }>(
              `/api/projects/${projectId}/members/${removeTarget.userId}`,
              { method: "DELETE" },
            );
            setRemoveTarget(null);
            if (leaving || payload.left) {
              router.push("/");
              router.refresh();
              return;
            }
            if (payload.members) setMembers(payload.members);
          });
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this project?"
        description="Webhook history and memberships are removed. This cannot be undone."
        confirmLabel="Delete project"
        pending={pending === "delete"}
        onConfirm={() => {
          void run("delete", async () => {
            await apiJson(`/api/projects/${projectId}`, {
              method: "DELETE",
              body: JSON.stringify({ confirmName }),
            });
            router.push("/");
            router.refresh();
          });
        }}
      />
    </div>
  );
}

function Field({
  id,
  label,
  className,
  ...props
}: ComponentProps<typeof Input> & { label: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={className} {...props} />
    </div>
  );
}
