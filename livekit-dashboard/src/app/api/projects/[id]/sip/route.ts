import { jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import {
  toDispatchRuleSnapshot,
  toInboundTrunkSnapshot,
  toOutboundTrunkSnapshot,
} from "@/lib/livekit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const [inbound, outbound, dispatch] = await Promise.all([
      access.livekit.sip.listInbound(),
      access.livekit.sip.listOutbound(),
      access.livekit.sip.listDispatch(),
    ]);
    return jsonOk({
      inbound: inbound.map(toInboundTrunkSnapshot),
      outbound: outbound.map(toOutboundTrunkSnapshot),
      dispatch: dispatch.map(toDispatchRuleSnapshot),
    });
  } catch (error) {
    return liveKitActionError(error);
  }
}
