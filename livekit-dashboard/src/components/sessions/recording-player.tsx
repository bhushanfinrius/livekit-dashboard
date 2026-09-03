"use client";

import { Pause, Play, RotateCcw, SkipBack, SkipForward, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatSessionClock } from "@/lib/format";
import type { SessionRecording } from "@/lib/sessions/types";
import { cn } from "@/lib/utils";

const SPEEDS = [0.5, 1, 1.5, 2];

export function RecordingPlayer({
  recordings,
  currentMs,
  onTime,
}: {
  recordings: SessionRecording[];
  currentMs: number;
  onTime: (ms: number) => void;
}) {
  const playable = recordings.filter((recording) => recording.playableUrl);
  // Mixed has both voices, so it is the sensible default for listening back.
  const preferred = playable.find((recording) => recording.role === "mixed") ?? playable[0];
  const [selectedId, setSelectedId] = useState(preferred?.id ?? recordings[0]?.id ?? "");
  const selected =
    recordings.find((recording) => recording.id === selectedId) ?? preferred ?? null;
  const mediaRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [durationMs, setDurationMs] = useState(
    (selected?.durationSeconds ?? 0) * 1000,
  );
  const [peaks, setPeaks] = useState<number[]>([]);
  const [zoom, setZoom] = useState(1);
  const [waveformError, setWaveformError] = useState<string | null>(null);

  const url = selected?.playableUrl ?? null;
  const preferredId = preferred?.id ?? "";

  // Recordings arrive after mount, so re-apply the mixed default once they land.
  useEffect(() => {
    if (preferredId && selectedId !== preferredId && !recordings.some((r) => r.id === selectedId)) {
      setSelectedId(preferredId);
    }
  }, [preferredId, recordings, selectedId]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    media.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !url) return;
    media.pause();
    media.src = url;
    media.load();
    setPlaying(false);
    setPeaks([]);
    setWaveformError(null);
    void decodePeaks(url)
      .then(setPeaks)
      .catch(() => {
        setWaveformError("Could not decode the waveform. Refresh the page, or run npm run recording:cors on the VPS if this keeps happening.");
      });
  }, [url]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const onTimeUpdate = () => onTime(media.currentTime * 1000);
    const onLoaded = () => setDurationMs(media.duration * 1000);
    const onEnded = () => setPlaying(false);
    media.addEventListener("timeupdate", onTimeUpdate);
    media.addEventListener("loadedmetadata", onLoaded);
    media.addEventListener("ended", onEnded);
    return () => {
      media.removeEventListener("timeupdate", onTimeUpdate);
      media.removeEventListener("loadedmetadata", onLoaded);
      media.removeEventListener("ended", onEnded);
    };
  }, [onTime, url]);

  const duration = durationMs || (selected?.durationSeconds ?? 0) * 1000;
  const progress = duration > 0 ? Math.min(1, currentMs / duration) : 0;
  const visiblePeaks = useMemo(() => {
    if (peaks.length === 0) return [];
    const count = Math.max(48, Math.round(120 * zoom));
    const step = peaks.length / count;
    const bars: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const start = Math.floor(i * step);
      const end = Math.max(start + 1, Math.floor((i + 1) * step));
      let max = 0;
      for (let j = start; j < end && j < peaks.length; j += 1) max = Math.max(max, peaks[j]);
      bars.push(max);
    }
    return bars;
  }, [peaks, zoom]);

  function seekTo(ms: number) {
    const media = mediaRef.current;
    const next = Math.max(0, Math.min(duration || ms, ms));
    if (media && Number.isFinite(media.duration)) media.currentTime = next / 1000;
    onTime(next);
  }

  async function togglePlay() {
    const media = mediaRef.current;
    if (!media || !url) return;
    if (playing) {
      media.pause();
      setPlaying(false);
      return;
    }
    await media.play();
    setPlaying(true);
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button type="button" size="icon-sm" variant="outline" onClick={() => void togglePlay()} disabled={!url}>
          {playing ? <Pause /> : <Play />}
        </Button>
        <select
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
          className="native-select h-8 rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30"
          aria-label="Playback speed"
        >
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value.toFixed(1)}x
            </option>
          ))}
        </select>
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => seekTo(0)} disabled={!url}>
          <RotateCcw />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => seekTo(currentMs - 5000)} disabled={!url}>
          <SkipBack />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => seekTo(currentMs + 5000)} disabled={!url}>
          <SkipForward />
        </Button>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatSessionClock(currentMs)} / {formatSessionClock(duration)}
        </p>
        {recordings.length > 1 ? (
          <select
            value={selected?.id ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
            className="native-select ml-auto h-8 max-w-[220px] rounded-md border border-input bg-transparent px-2 font-mono text-xs dark:bg-input/30"
            aria-label="Recording"
          >
            {recordings.map((recording) => (
              <option key={recording.id} value={recording.id}>
                {recording.label}
                {recording.playableUrl ? "" : ` · ${recording.status}`}
              </option>
            ))}
          </select>
        ) : (
          <span className="ml-auto" />
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
          disabled={zoom <= 1}
        >
          <ZoomOut />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => setZoom((value) => Math.min(4, value + 0.5))}
        >
          <ZoomIn />
        </Button>
      </div>

      <audio ref={mediaRef} className="hidden" preload="metadata" />

      <button
        type="button"
        className="relative block h-24 w-full overflow-hidden px-3 py-3"
        disabled={!url}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          seekTo(ratio * duration);
        }}
      >
        {visiblePeaks.length > 0 ? (
          <div className="flex h-full items-end gap-px">
            {visiblePeaks.map((peak, index) => (
              <span
                key={index}
                className="flex-1 rounded-sm bg-live/70"
                style={{ height: `${Math.max(6, peak * 100)}%` }}
              />
            ))}
          </div>
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {!selected
              ? "No recording for this session"
              : url
                ? waveformError ?? "Loading audio waveforms"
                : "Recording file is not a browser-playable HTTP(S) URL"}
          </p>
        )}
        <span
          className="pointer-events-none absolute inset-y-3 w-px bg-live"
          style={{ left: `${progress * 100}%` }}
        />
      </button>
    </section>
  );
}

async function decodePeaks(url: string) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error("fetch failed");
  const buffer = await response.arrayBuffer();
  const context = new AudioContext();
  const audio = await context.decodeAudioData(buffer.slice(0));
  await context.close();
  const channel = audio.getChannelData(0);
  const buckets = 400;
  const step = Math.max(1, Math.floor(channel.length / buckets));
  const peaks: number[] = [];
  for (let i = 0; i < buckets; i += 1) {
    let max = 0;
    const start = i * step;
    for (let j = start; j < start + step && j < channel.length; j += 1) {
      max = Math.max(max, Math.abs(channel[j]));
    }
    peaks.push(max);
  }
  const peak = Math.max(...peaks, 0.01);
  return peaks.map((value) => value / peak);
}

export function InsightsLegend() {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <li className="flex items-center gap-2">
        <span className="size-2 rounded-sm bg-zinc-400" /> User
      </li>
      <li className="flex items-center gap-2">
        <span className="size-2 rounded-sm bg-violet-400" /> Agent
      </li>
      <li className={cn("flex items-center gap-2")}>
        <span className="size-2 rounded-sm border border-dashed border-muted-foreground" /> Interruption
      </li>
    </ul>
  );
}
