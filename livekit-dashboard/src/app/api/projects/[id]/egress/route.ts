import { jsonError, jsonOk } from "@/lib/http";
import { liveKitActionError, readJsonBody, requireProjectLiveKit } from "@/lib/api/project";
import { recordingOutputError, roomCompositeFileOutput } from "@/lib/egress/recording";
import { splitEgressJobs, toEgressSnapshot } from "@/lib/livekit";
import { startRecordingSchema } from "@/lib/validators/egress";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const jobs = (await access.livekit.egress.list()).map(toEgressSnapshot);
    return jsonOk({ ...splitEgressJobs(jobs), recordingError: recordingOutputError() });
  } catch (error) {
    return liveKitActionError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await readJsonBody(request);
  if (body.error) return body.error;
  const parsed = startRecordingSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid recording request", 400, "VALIDATION");
  }

  const configError = recordingOutputError();
  if (configError) return jsonError(configError, 400, "VALIDATION");

  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const job = await access.livekit.egress.startRoomComposite(
      parsed.data.roomName,
      roomCompositeFileOutput(),
      { audioOnly: parsed.data.audioOnly },
    );
    return jsonOk({ egress: toEgressSnapshot(job) }, 201);
  } catch (error) {
    return liveKitActionError(error);
  }
}
