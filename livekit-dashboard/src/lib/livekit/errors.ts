export class ProjectAccessError extends Error {
  readonly status: 401 | 403 | 404;
  readonly code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND";

  constructor(status: 401 | 403 | 404, message: string) {
    super(message);
    this.name = "ProjectAccessError";
    this.status = status;
    this.code =
      status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : "NOT_FOUND";
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause =
    error.cause instanceof Error
      ? error.cause.message
      : typeof error.cause === "string"
        ? error.cause
        : "";
  return [error.message, cause].filter(Boolean).join(": ");
}

export function liveKitErrorMessage(error: unknown) {
  const message = errorText(error);
  if (/timed out/i.test(message)) {
    return "Timed out reaching the LiveKit server. Is Docker Compose up (`npm run docker:up`)?";
  }
  if (/fetch failed|econnrefused|enotfound|ehostunreach|network/i.test(message)) {
    return "Could not reach the LiveKit server at that URL. Run `npm run docker:up` and use http://127.0.0.1:7880.";
  }
  if (/unauthorized|invalid|jwt|permission|403|401/i.test(message)) {
    return "LiveKit rejected these credentials. Use the API key and secret from livekit.yaml (the onboarding form loads them). Do not generate a new pair inside the LumiVoice Docker container.";
  }
  if (/not found|does not exist|no such/i.test(message)) {
    return "That room or participant is no longer on the LiveKit server.";
  }
  if (/sip/i.test(message)) {
    return `SIP API failed: ${message}. Trunks/rules are stored on livekit-server; actual calls need the livekit-sip service.`;
  }
  if (/egress/i.test(message)) {
    return `Egress API failed: ${message}. Listing/stopping jobs talks to livekit-server; actual recording needs a livekit-egress worker.`;
  }
  if (/ingress/i.test(message)) {
    return `Ingress API failed: ${message}. Endpoints are stored on livekit-server; pushing media needs a livekit-ingress worker.`;
  }
  return `LiveKit check failed: ${message}`;
}
