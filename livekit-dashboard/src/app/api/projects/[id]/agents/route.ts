import { jsonOk } from "@/lib/http";
import { liveKitActionError, requireProjectLiveKit } from "@/lib/api/project";
import { toAgentDispatchSnapshot, toParticipantSnapshot } from "@/lib/livekit";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const access = await requireProjectLiveKit(id);
  if (access.error) return access.error;

  try {
    const rooms = await access.livekit.rooms.list();
    const sessions = await Promise.all(
      rooms.map(async (room) => {
        const [participants, dispatches] = await Promise.all([
          access.livekit.rooms.listParticipants(room.name),
          access.livekit.agents.listDispatch(room.name).catch(() => []),
        ]);
        return {
          roomName: room.name,
          agents: participants
            .filter((participant) => participant.kind === 4)
            .map(toParticipantSnapshot),
          sip: participants
            .filter((participant) => participant.kind === 3)
            .map(toParticipantSnapshot),
          dispatches: dispatches.map(toAgentDispatchSnapshot),
        };
      }),
    );

    return jsonOk({
      sessions: sessions.filter(
        (session) =>
          session.agents.length > 0 ||
          session.sip.length > 0 ||
          session.dispatches.length > 0,
      ),
    });
  } catch (error) {
    return liveKitActionError(error);
  }
}
