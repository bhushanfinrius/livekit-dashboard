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
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = outboundTrunkSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid trunk", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const trunk = await access.livekit.sip.createOutbound(
      parsed.data.name,
      parsed.data.address,
      parsed.data.numbers,
      {
        transport: sipTransportCode(parsed.data.transport),
        authUsername: parsed.data.authUsername || undefined,
        authPassword: parsed.data.authPassword || undefined,
        mediaEncryption: sipMediaEncryptionCode(parsed.data.mediaEncryption),
        metadata: parsed.data.metadata,
      },
    );
    return jsonOk({ trunk: toOutboundTrunkSnapshot(trunk) }, 201);
  } catch (error) {
    return liveKitActionError(error);
  }
}
