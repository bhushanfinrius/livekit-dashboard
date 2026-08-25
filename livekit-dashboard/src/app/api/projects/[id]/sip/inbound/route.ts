import { jsonError, jsonOk } from "@/lib/http";
import {
  liveKitActionError,
  readJsonBody,
  requireProjectLiveKit,
} from "@/lib/api/project";
import { sipMediaEncryptionCode, toInboundTrunkSnapshot } from "@/lib/livekit";
import { inboundTrunkSchema } from "@/lib/validators/sip";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = inboundTrunkSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid trunk", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const trunk = await access.livekit.sip.createInbound(parsed.data.name, parsed.data.numbers, {
      allowedAddresses: parsed.data.allowedAddresses,
      allowedNumbers: parsed.data.allowedNumbers,
      authUsername: parsed.data.authUsername || undefined,
      authPassword: parsed.data.authPassword || undefined,
      mediaEncryption: sipMediaEncryptionCode(parsed.data.mediaEncryption),
      krispEnabled: parsed.data.krispEnabled,
      metadata: parsed.data.metadata,
    });
    return jsonOk({ trunk: toInboundTrunkSnapshot(trunk) }, 201);
  } catch (error) {
    return liveKitActionError(error);
  }
}
