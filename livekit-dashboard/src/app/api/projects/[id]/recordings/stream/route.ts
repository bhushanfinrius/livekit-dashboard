import { jsonError } from "@/lib/http";
import { requireProjectMember } from "@/lib/api/project";
import { parseGcsLocation, resolvePlayableUrl } from "@/lib/gcs";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isGcsHttpUrl(value: string) {
  try {
    const url = new URL(value.split("?")[0]);
    return /storage\.googleapis\.com$/i.test(url.hostname) || /storage\.cloud\.google\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** Same-origin proxy so the session player can decode waveforms without GCS CORS. */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectMember(id);
  if ("error" in access) return access.error;

  const location = new URL(request.url).searchParams.get("u")?.trim() ?? "";
  if (!location || (!parseGcsLocation(location) && !isGcsHttpUrl(location))) {
    return jsonError("Not a GCS recording URL", 400, "VALIDATION");
  }

  const signed = (await resolvePlayableUrl(location)) ?? location;
  const range = request.headers.get("range");
  const upstream = await fetch(signed, {
    headers: range ? { range } : undefined,
  });
  if (!upstream.ok && upstream.status !== 206) {
    return new Response(await upstream.text(), { status: upstream.status });
  }

  const headers = new Headers();
  for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }
  if (!headers.has("content-type")) headers.set("content-type", "audio/ogg");
  headers.set("cache-control", "private, max-age=60");
  return new Response(upstream.body, { status: upstream.status, headers });
}
