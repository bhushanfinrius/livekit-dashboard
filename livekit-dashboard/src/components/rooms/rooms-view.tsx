"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { EmptyState } from "@/components/empty-state";
import { RoomDrawer } from "@/components/rooms/room-drawer";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiJson } from "@/lib/api/client";
import type { LiveWebhookEvent } from "@/lib/events/types";
import { formatDuration } from "@/lib/format";
import { ROOM_LIVE_EVENTS } from "@/lib/livekit/types";
import type { ParticipantSnapshot, RoomSnapshot } from "@/lib/livekit/types";

const MeetSession = dynamic(
  () => import("@/components/console/meet-session").then((mod) => mod.MeetSession),
  { ssr: false },
);

function roomUrl(projectId: string, room: string, suffix = "") {
  return `/api/projects/${projectId}/rooms/${encodeURIComponent(room)}${suffix}`;
}

export function RoomsView({
  projectId,
  initialRooms,
  initialError = null,
}: {
  projectId: string;
  initialRooms: RoomSnapshot[];
  initialError?: string | null;
}) {
  const [rooms, setRooms] = useState(initialRooms);
  const [error, setError] = useState<string | null>(initialError);
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [participants, setParticipants] = useState<ParticipantSnapshot[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [meet, setMeet] = useState<{
    token: string;
    wsUrl: string;
    roomName: string;
    loopback: boolean;
  } | null>(null);
  const selectedRef = useRef(selectedName);
  selectedRef.current = selectedName;

  const loadRooms = useCallback(async () => {
    const payload = await apiJson<{ rooms: RoomSnapshot[] }>(`/api/projects/${projectId}/rooms`);
    setRooms(payload.rooms);
    setError(null);
    const selected = selectedRef.current;
    if (selected && !payload.rooms.some((room) => room.name === selected)) {
      setSelectedName(null);
      setParticipants([]);
    }
  }, [projectId]);

  const loadParticipants = useCallback(
    async (room: string) => {
      const payload = await apiJson<{ participants: ParticipantSnapshot[] }>(
        `${roomUrl(projectId, room)}/participants`,
      );
      if (selectedRef.current === room) {
        setParticipants(payload.participants);
        setActionError(null);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void loadRooms().catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not load rooms");
      });
    }, 5000);
    return () => window.clearInterval(poll);
  }, [loadRooms]);

  useEffect(() => {
    if (!selectedName) return;
    void loadParticipants(selectedName).catch((caught: unknown) => {
      setActionError(caught instanceof Error ? caught.message : "Could not load participants");
    });
    const poll = window.setInterval(() => {
      void loadParticipants(selectedName).catch(() => {});
    }, 3000);
    return () => window.clearInterval(poll);
  }, [loadParticipants, selectedName]);

  useEffect(() => {
    const source = new EventSource(`/api/projects/${projectId}/events/stream`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveWebhookEvent;
      if (!ROOM_LIVE_EVENTS.has(event.eventType)) return;
      void loadRooms().catch(() => {});
      const selected = selectedRef.current;
      if (selected && event.roomName === selected) {
        void loadParticipants(selected).catch(() => {});
      }
    };
    return () => source.close();
  }, [loadParticipants, loadRooms, projectId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rooms;
    return rooms.filter((room) => room.name.toLowerCase().includes(needle));
  }, [query, rooms]);

  const selectedRoom = rooms.find((room) => room.name === selectedName) ?? null;

  async function runAction(key: string, work: () => Promise<void>): Promise<boolean> {
    setPendingKey(key);
    setActionError(null);
    try {
      await work();
      return true;
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Action failed");
      return false;
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by room name"
          className="max-w-sm font-mono"
        />
        <p className="text-xs text-muted-foreground">
          {rooms.length} active room{rooms.length === 1 ? "" : "s"} · updates live
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {rooms.length === 0 && !error ? (
        <EmptyState
          title="No active rooms — waiting for a client to connect"
          description="When a participant joins a room on this LiveKit server, it will show up here with live participant counts."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No rooms match that name"
          description="Clear the filter to see every active room on this server."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-panel-2 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Room</th>
                <th className="px-3 py-2 font-medium">Participants</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Max</th>
                <th className="px-3 py-2 font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((room) => (
                <tr
                  key={room.sid}
                  tabIndex={0}
                  className="cursor-pointer border-t border-border hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                  onClick={() => setSelectedName(room.name)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedName(room.name);
                    }
                  }}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="live-dot size-2 shrink-0 rounded-full" aria-hidden />
                      <span className="font-mono">{room.name}</span>
                      {room.activeRecording ? (
                        <Badge variant="secondary" className="text-live">
                          recording
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {room.numParticipants}
                    {room.numPublishers > 0 ? (
                      <span className="text-muted-foreground"> · {room.numPublishers} pub</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">
                    {formatDuration((now - Date.parse(room.createdAt)) / 1000)}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {room.maxParticipants || "—"}
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-2 font-mono text-xs text-muted-foreground">
                    {room.metadata || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RoomDrawer
        open={Boolean(selectedName)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedName(null);
            setParticipants([]);
            setActionError(null);
          }
        }}
        room={selectedRoom}
        participants={participants}
        now={now}
        error={actionError}
        pendingKey={pendingKey}
        onSaveMetadata={async (metadata) => {
          if (!selectedName) return false;
          return runAction("metadata", async () => {
            const payload = await apiJson<{ room: RoomSnapshot }>(
              `${roomUrl(projectId, selectedName)}/metadata`,
              { method: "POST", body: JSON.stringify({ metadata }) },
            );
            setRooms((current) =>
              current.map((room) => (room.name === payload.room.name ? payload.room : room)),
            );
          });
        }}
        onStartRecording={async () => {
          if (!selectedName) return false;
          return runAction("record", async () => {
            await apiJson(`/api/projects/${projectId}/egress`, {
              method: "POST",
              body: JSON.stringify({ roomName: selectedName, audioOnly: true }),
            });
            await loadRooms();
          });
        }}
        onJoin={async () => {
          if (!selectedName) return false;
          return runAction("join", async () => {
            const payload = await apiJson<{
              token: string;
              wsUrl: string;
              roomName: string;
              loopback: boolean;
            }>(`/api/projects/${projectId}/console`, {
              method: "POST",
              body: JSON.stringify({ roomName: selectedName, dispatchAgent: false }),
            });
            setMeet(payload);
          });
        }}
        onMuteTrack={async (identity, trackSid, muted) => {
          if (!selectedName) return false;
          return runAction(`mute:${identity}:${trackSid}`, async () => {
            await apiJson(`${roomUrl(projectId, selectedName)}/participants/${encodeURIComponent(identity)}/tracks/${encodeURIComponent(trackSid)}/mute`, {
              method: "POST",
              body: JSON.stringify({ muted }),
            });
            await loadParticipants(selectedName);
          });
        }}
        onRemoveParticipant={async (identity) => {
          if (!selectedName) return false;
          return runAction(`remove:${identity}`, async () => {
            await apiJson(
              `${roomUrl(projectId, selectedName)}/participants/${encodeURIComponent(identity)}/remove`,
              { method: "POST" },
            );
            await Promise.all([loadRooms(), loadParticipants(selectedName)]);
          });
        }}
        onEndRoom={async () => {
          if (!selectedName) return false;
          return runAction("end", async () => {
            await apiJson(`${roomUrl(projectId, selectedName)}/end`, { method: "POST" });
            setSelectedName(null);
            setParticipants([]);
            await loadRooms();
          });
        }}
      />

      <Sheet open={Boolean(meet)} onOpenChange={(open) => !open && setMeet(null)}>
        <SheetContent className="overflow-y-auto sm:max-w-4xl">
          <SheetHeader>
            <SheetTitle>Join · {meet?.roomName ?? "room"}</SheetTitle>
          </SheetHeader>
          {meet?.loopback ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Connecting to a local LiveKit URL. Other devices need the public wss:// URL in
              Settings.
            </p>
          ) : null}
          <div className="mt-4">
            {meet ? (
              <MeetSession token={meet.token} serverUrl={meet.wsUrl} onLeave={() => setMeet(null)} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
