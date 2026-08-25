"use client";

import { LiveKitRoom, RoomAudioRenderer, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";
import { Button } from "@/components/ui/button";

export function MeetSession({
  token,
  serverUrl,
  audioOnly = false,
  onConnected,
  onLeave,
}: {
  token: string;
  serverUrl: string;
  audioOnly?: boolean;
  onConnected?: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="space-y-3">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        audio
        video={!audioOnly}
        className="lk-deck-meet min-h-[420px] overflow-hidden rounded-lg border border-border"
        data-lk-theme="default"
        onConnected={onConnected}
        onDisconnected={onLeave}
      >
        <RoomAudioRenderer />
        <VideoConference />
      </LiveKitRoom>
      <Button type="button" variant="outline" onClick={onLeave}>
        Leave
      </Button>
    </div>
  );
}
