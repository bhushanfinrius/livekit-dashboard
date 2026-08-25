"use client";

import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDuration, formatWhen } from "@/lib/format";
import type { ParticipantSnapshot, RoomSnapshot, TrackSnapshot } from "@/lib/livekit/types";
import { cn } from "@/lib/utils";

function TrackMuteButton({
  track,
  pending,
  onToggle,
}: {
  track: TrackSnapshot;
  pending: boolean;
  onToggle: (muted: boolean) => void;
}) {
  if (track.type === "data") {
    return (
      <Badge variant="outline" className="font-mono">
        data
      </Badge>
    );
  }

  const muted = track.muted;
  const Icon = track.type === "audio" ? (muted ? MicOff : Mic) : muted ? VideoOff : Video;

  return (
    <Button
      type="button"
      size="sm"
      variant={muted ? "secondary" : "outline"}
      disabled={pending}
      onClick={() => onToggle(!muted)}
    >
      <Icon />
      {muted ? "Unmute" : "Mute"}
    </Button>
  );
}

export function RoomDrawer({
  open,
  onOpenChange,
  room,
  participants,
  now,
  error,
  pendingKey,
  onSaveMetadata,
  onStartRecording,
  onJoin,
  onMuteTrack,
  onRemoveParticipant,
  onEndRoom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: RoomSnapshot | null;
  participants: ParticipantSnapshot[];
  now: number;
  error: string | null;
  pendingKey: string | null;
  onSaveMetadata: (metadata: string) => Promise<boolean>;
  onStartRecording: () => Promise<boolean>;
  onJoin?: () => Promise<boolean>;
  onMuteTrack: (identity: string, trackSid: string, muted: boolean) => Promise<boolean>;
  onRemoveParticipant: (identity: string) => Promise<boolean>;
  onEndRoom: () => Promise<boolean>;
}) {
  const [metadata, setMetadata] = useState(room?.metadata ?? "");
  const [dirty, setDirty] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [removeIdentity, setRemoveIdentity] = useState<string | null>(null);

  useEffect(() => {
    if (!room) {
      setMetadata("");
      setDirty(false);
      return;
    }
    if (!dirty) setMetadata(room.metadata);
  }, [room, dirty]);

  const duration = room ? formatDuration((now - Date.parse(room.createdAt)) / 1000) : "";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-hidden sm:max-w-xl"
        >
          <SheetHeader className="border-b border-border">
            <SheetTitle className="font-mono text-base">{room?.name ?? "Room"}</SheetTitle>
            <SheetDescription>
              {room ? `${participants.length} participant${participants.length === 1 ? "" : "s"} · ${duration}` : "Loading room"}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-6 px-4 py-4">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <section className="space-y-2">
                <Label htmlFor="room-metadata">Room metadata</Label>
                <textarea
                  id="room-metadata"
                  value={metadata}
                  onChange={(event) => {
                    setMetadata(event.target.value);
                    setDirty(true);
                  }}
                  rows={3}
                  className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!dirty || pendingKey === "metadata"}
                  onClick={async () => {
                    const saved = await onSaveMetadata(metadata);
                    if (saved) setDirty(false);
                  }}
                >
                  {pendingKey === "metadata" ? "Saving…" : "Save metadata"}
                </Button>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Join</h3>
                <p className="text-sm text-muted-foreground">
                  Open this room in Deck with mic and camera, like LiveKit Meet.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={!onJoin || pendingKey === "join"}
                  onClick={() => void onJoin?.()}
                >
                  {pendingKey === "join" ? "Joining…" : "Join"}
                </Button>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-medium">Recording</h3>
                <p className="text-sm text-muted-foreground">
                  Starts an audio-only room composite and uploads the file to your GCS bucket.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingKey === "record" || Boolean(room?.activeRecording)}
                  onClick={() => void onStartRecording()}
                >
                  {pendingKey === "record"
                    ? "Starting…"
                    : room?.activeRecording
                      ? "Recording"
                      : "Start recording"}
                </Button>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-medium">Participants</h3>
                {participants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No participants in this room.</p>
                ) : (
                  participants.map((participant) => (
                    <article
                      key={participant.sid}
                      className="space-y-3 rounded-lg border border-border bg-card p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-sm">{participant.identity}</p>
                          {participant.name && participant.name !== participant.identity ? (
                            <p className="truncate text-xs text-muted-foreground">{participant.name}</p>
                          ) : null}
                        </div>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "capitalize",
                            participant.state === "active" && "text-live",
                          )}
                        >
                          {participant.state}
                        </Badge>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <div>
                          <dt className="uppercase">Joined</dt>
                          <dd className="font-mono text-foreground">{formatWhen(participant.joinedAt)}</dd>
                        </div>
                        <div>
                          <dt className="uppercase">Kind</dt>
                          <dd className="capitalize text-foreground">{participant.kind}</dd>
                        </div>
                        <div>
                          <dt className="uppercase">Publisher</dt>
                          <dd className="text-foreground">{participant.isPublisher ? "yes" : "no"}</dd>
                        </div>
                        <div>
                          <dt className="uppercase">Region</dt>
                          <dd className="font-mono text-foreground">{participant.region || "—"}</dd>
                        </div>
                      </dl>
                      <ul className="space-y-2">
                        {participant.tracks.length === 0 ? (
                          <li className="text-xs text-muted-foreground">No published tracks</li>
                        ) : (
                          participant.tracks.map((track) => (
                            <li
                              key={track.sid}
                              className="flex items-center justify-between gap-2 rounded-md bg-panel-2 px-2 py-2"
                            >
                              <div className="min-w-0">
                                <p className="font-mono text-xs">
                                  {track.type}
                                  {track.source !== "unknown" ? ` · ${track.source}` : ""}
                                  {track.muted ? " · muted" : ""}
                                </p>
                                <p className="truncate font-mono text-[11px] text-muted-foreground">
                                  {track.name || track.sid}
                                </p>
                              </div>
                              <TrackMuteButton
                                track={track}
                                pending={pendingKey === `mute:${participant.identity}:${track.sid}`}
                                onToggle={(muted) =>
                                  onMuteTrack(participant.identity, track.sid, muted)
                                }
                              />
                            </li>
                          ))
                        )}
                      </ul>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={pendingKey === `remove:${participant.identity}`}
                        onClick={() => setRemoveIdentity(participant.identity)}
                      >
                        Remove participant
                      </Button>
                    </article>
                  ))
                )}
              </section>
            </div>
          </ScrollArea>

          <div className="border-t border-border p-4">
            <Button type="button" variant="destructive" className="w-full" onClick={() => setEndOpen(true)}>
              End room
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        title="End this room?"
        description="Everyone will be disconnected and the room will disappear from the live list."
        confirmLabel="End room"
        pending={pendingKey === "end"}
        onConfirm={async () => {
          if (await onEndRoom()) setEndOpen(false);
        }}
      />

      <ConfirmDialog
        open={Boolean(removeIdentity)}
        onOpenChange={(next) => {
          if (!next) setRemoveIdentity(null);
        }}
        title="Remove participant?"
        description={
          removeIdentity
            ? `${removeIdentity} will be disconnected from this room.`
            : "This participant will be disconnected from the room."
        }
        confirmLabel="Remove"
        pending={removeIdentity ? pendingKey === `remove:${removeIdentity}` : false}
        onConfirm={async () => {
          if (!removeIdentity) return;
          if (await onRemoveParticipant(removeIdentity)) setRemoveIdentity(null);
        }}
      />
    </>
  );
}
