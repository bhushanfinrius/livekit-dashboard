import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { RecordingCheckStatus, RecordingReadiness } from "@/lib/egress/readiness";

const TONE: Record<RecordingCheckStatus, { wrapper: string; icon: string }> = {
  ok: {
    wrapper: "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    icon: "text-emerald-500",
  },
  warn: {
    wrapper: "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300",
    icon: "text-amber-500",
  },
  fail: {
    wrapper: "border-destructive/40 bg-destructive/5 text-destructive",
    icon: "text-destructive",
  },
};

const HEADLINE: Record<RecordingCheckStatus, string> = {
  ok: "Recording is ready",
  warn: "Recording works, with gaps",
  fail: "Calls will not be recorded",
};

function StatusIcon({ status, className }: { status: RecordingCheckStatus; className?: string }) {
  const Icon = status === "ok" ? CheckCircle2 : status === "warn" ? AlertTriangle : XCircle;
  return <Icon className={className} aria-hidden />;
}

export function RecordingReadinessBanner({ readiness }: { readiness: RecordingReadiness }) {
  if (readiness.status === "ok") return null;
  const tone = TONE[readiness.status];
  const problems = readiness.checks.filter((check) => check.status !== "ok");

  return (
    <div className={`rounded-lg border p-4 text-sm ${tone.wrapper}`}>
      <div className="flex items-center gap-2 font-medium">
        <StatusIcon status={readiness.status} className={`size-4 ${tone.icon}`} />
        {HEADLINE[readiness.status]}
      </div>
      <ul className="mt-3 space-y-2">
        {problems.map((check) => (
          <li key={check.id} className="flex gap-2">
            <StatusIcon status={check.status} className="mt-0.5 size-3.5 shrink-0 opacity-70" />
            <span>
              <span className="font-medium">{check.label}:</span> {check.detail}
              {check.fix ? (
                <>
                  {" "}
                  <code className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-xs">
                    {check.fix}
                  </code>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
