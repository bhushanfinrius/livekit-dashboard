import { auth } from "@/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { applyLocalLiveKitKeys, readLocalLiveKitKeys } from "@/lib/livekit/apply-local-keys";
import { liveKitErrorMessage } from "@/lib/livekit/errors";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  try {
    return jsonOk(readLocalLiveKitKeys());
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Could not read livekit.yaml",
      500,
      "CONFIG",
    );
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  let replaces: string | undefined;
  try {
    const body = (await request.json()) as { replacesApiKey?: string };
    replaces = body.replacesApiKey?.trim() || undefined;
  } catch {
    replaces = undefined;
  }

  try {
    const keys = await applyLocalLiveKitKeys(replaces);
    return jsonOk({
      ...keys,
      applied: true,
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : liveKitErrorMessage(error),
      400,
      "LIVEKIT",
    );
  }
}
