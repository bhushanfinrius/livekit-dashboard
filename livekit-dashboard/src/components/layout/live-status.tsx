"use client";

import { useEffect, useState } from "react";

export function LiveStatus({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<"connecting" | "live" | "waiting">("connecting");

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events/stream`);
    setStatus("connecting");

    source.onopen = () => setStatus("waiting");
    source.onmessage = () => setStatus("live");
    source.onerror = () => setStatus("connecting");

    return () => source.close();
  }, [projectId]);

  const label =
    status === "live" ? "live" : status === "waiting" ? "waiting for events" : "connecting…";

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <span
        className={`size-2 rounded-full ${status === "connecting" ? "bg-muted-foreground/50" : "live-dot"}`}
        aria-hidden
      />
      <span>{label}</span>
    </div>
  );
}
