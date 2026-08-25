import type { Metadata } from "next";
import { auth } from "@/auth";
import { EmptyState } from "@/components/empty-state";
import { RoomsView } from "@/components/rooms/rooms-view";
import {
  getProjectLiveKit,
  liveKitErrorMessage,
  ProjectAccessError,
  toRoomSnapshot,
} from "@/lib/livekit";

export const metadata: Metadata = {
  title: "Rooms",
};

export const dynamic = "force-dynamic";

export default async function RoomsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <EmptyState
        title="Rooms are not available"
        description="Sign in to watch live rooms on this LiveKit server."
      />
    );
  }

  try {
    const livekit = await getProjectLiveKit(session.user.id, projectId);
    const rooms = (await livekit.rooms.list()).map(toRoomSnapshot);
    return <RoomsView projectId={projectId} initialRooms={rooms} />;
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return (
        <EmptyState
          title="Rooms are not available"
          description="You need access to this project to view its live rooms."
        />
      );
    }
    return (
      <RoomsView
        projectId={projectId}
        initialRooms={[]}
        initialError={liveKitErrorMessage(error)}
      />
    );
  }
}
