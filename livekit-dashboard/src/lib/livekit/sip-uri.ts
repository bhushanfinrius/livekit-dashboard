const DEFAULT_SIP_PORT = "5060";

function hostnameOf(url: string | null | undefined) {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed.replace(/^ws/, "http")).hostname || null;
  } catch {
    return null;
  }
}

/**
 * One SIP service fronts every project on a self-hosted install, so this is the same
 * endpoint for all of them: point the carrier here, and a call reaches a project via the
 * phone numbers on that project's inbound trunk.
 */
export function sipUriForProject(input: {
  livekitUrl: string;
  publicLivekitUrl?: string | null;
}) {
  const host =
    process.env.SIP_PUBLIC_HOST?.trim() ||
    process.env.LIVEKIT_PUBLIC_IP?.trim() ||
    hostnameOf(input.publicLivekitUrl) ||
    hostnameOf(input.livekitUrl);
  if (!host) return null;

  const port = process.env.SIP_PUBLIC_PORT?.trim() || DEFAULT_SIP_PORT;
  return port === DEFAULT_SIP_PORT ? `sip:${host}` : `sip:${host}:${port}`;
}
