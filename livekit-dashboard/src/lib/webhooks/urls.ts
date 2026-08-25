export function sharedWebhookPath() {
  return "/api/webhooks/livekit";
}

export function projectWebhookPath(projectId: string) {
  return `/api/webhooks/livekit/${projectId}`;
}

export function toDockerHostUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      parsed.hostname = "host.docker.internal";
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}
