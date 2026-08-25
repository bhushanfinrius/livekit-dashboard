import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, readJsonBody, requireProjectLiveKit } from "@/lib/api/project";
import { toIngressSnapshot } from "@/lib/livekit";
import { createIngressSchema } from "@/lib/validators/egress";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const ingress = (await access.livekit.ingress.list()).map(toIngressSnapshot);
    return jsonOk({ ingress });
  } catch (error) {
    return liveKitActionError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = createIngressSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid ingress", 400, "VALIDATION");
  }

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  const identity =
    parsed.data.participantIdentity?.trim() ||
    `ingress-${parsed.data.roomName.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "room"}`;

  try {
    const created = await access.livekit.ingress.create({
      inputType: parsed.data.inputType,
      name: parsed.data.name?.trim() || `${parsed.data.inputType} ${parsed.data.roomName}`,
      roomName: parsed.data.roomName,
      participantIdentity: identity,
    });
    return jsonOk({ ingress: toIngressSnapshot(created) }, 201);
  } catch (error) {
    return liveKitActionError(error);
  }
}
