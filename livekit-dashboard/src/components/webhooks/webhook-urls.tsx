"use client";

import { useEffect, useState } from "react";
import { CopyField } from "@/components/copy-field";
import {
  projectWebhookPath,
  sharedWebhookPath,
  toDockerHostUrl,
} from "@/lib/webhooks/urls";

export function WebhookUrls({ projectId }: { projectId: string }) {
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const projectUrl = origin ? `${origin}${projectWebhookPath(projectId)}` : "";
  const sharedUrl = origin ? `${origin}${sharedWebhookPath()}` : "";

  return (
    <div className="space-y-3">
      <CopyField label="Project webhook URL" value={projectUrl} />
      <CopyField label="Shared URL (matches local compose)" value={sharedUrl} />
      {sharedUrl ? (
        <CopyField
          label="Docker LiveKit URL"
          value={toDockerHostUrl(sharedUrl)}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        Compose already posts to the Docker URL. If Next.js bound a different
        port, update <span className="font-mono">livekit.yaml</span> and
        recreate the LiveKit container.
      </p>
    </div>
  );
}
