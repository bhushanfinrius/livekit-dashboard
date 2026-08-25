import { jsonError, jsonOk } from "@/lib/http";
import {
  liveKitActionError,
  readJsonBody,
  requireProjectLiveKit,
} from "@/lib/api/project";
import { sipMediaEncryptionCode, sipTransportCode, toOutboundTrunkSnapshot } from "@/lib/livekit";
import { outboundTrunkSchema } from "@/lib/validators/sip";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; trunkId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id, trunkId } = await context.params;
  if (!trunkId) return jsonError("Trunk id is required", 400, "VALIDATION");
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = outboundTrunkSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid trunk", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const trunk = await access.livekit.sip.updateOutbound(trunkId, {
      name: parsed.data.name,
      address: parsed.data.address,
      transport: sipTransportCode(parsed.data.transport),
      numbers: parsed.data.numbers,
      authUsername: parsed.data.authUsername || "",
      authPassword: parsed.data.authPassword || undefined,
      mediaEncryption: sipMediaEncryptionCode(parsed.data.mediaEncryption),
    });
    return jsonOk({ trunk: toOutboundTrunkSnapshot(trunk) });
  } catch (error) {
    return liveKitActionError(error);
  }
}
