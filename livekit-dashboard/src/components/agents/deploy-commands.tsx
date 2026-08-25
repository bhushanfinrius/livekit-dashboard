"use client";

import type { ReactNode } from "react";
import { CopyField } from "@/components/copy-field";
import { buildAgentDeployGuide } from "@/lib/livekit/deploy-commands";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
      <span className="mt-0.5 flex size-6 items-center justify-center rounded-full bg-muted font-mono text-xs font-medium">
        {n}
      </span>
      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

export function DeployCommands({
  livekitUrl,
  apiKey,
  apiSecret,
  agentName,
  starterDir,
  canManage,
}: {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string | null;
  agentName: string;
  starterDir: string;
  canManage: boolean;
}) {
  const guide = buildAgentDeployGuide({
    livekitUrl,
    apiKey,
    apiSecret: canManage ? apiSecret : null,
    agentName,
    starterDir,
  });

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-medium">Deploy an agent to this LiveKit server</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Put this project&apos;s LiveKit URL, key, and secret in{" "}
          <span className="font-mono">.env.local</span>, plus whatever STT/TTS/LLM or realtime
          keys that agent needs. Deploy copies the whole file.
        </p>
      </div>

      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        Do not run <span className="font-mono">lk cloud auth</span> or{" "}
        <span className="font-mono">lk agent create</span>. Those deploy to Cloud. Prefer{" "}
        <strong>Deploy worker</strong> copies the starter <span className="font-mono">.env.local</span>{" "}
        and overlays this project&apos;s LiveKit keys. Commands below are the host-side fallback.
        See{" "}
        <a
          href="https://docs.livekit.io/deploy/custom/deployments/"
          className="text-foreground underline-offset-4 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          self-hosted deployments
        </a>
        .
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <CopyField label="LiveKit URL (agents use ws)" value={guide.wsUrl} />
        <CopyField label="API key" value={guide.apiKey} />
        {canManage ? (
          <CopyField label="API secret" value={guide.apiSecret ?? ""} secret />
        ) : (
          <CopyField label="API secret" value="Only project owners can copy the secret" />
        )}
        <CopyField label="Agent name" value={guide.agentName} />
      </div>

      <ol className="space-y-5">
        <Step n={1} title="Install the LiveKit CLI (optional)">
          <p className="text-sm text-muted-foreground">
            Needed only if you dispatch from a terminal instead of the form below.
          </p>
          <CopyField label="Windows" value={guide.installCli} />
        </Step>

        <Step n={2} title="Write this project into the Python starter">
          <p className="text-sm text-muted-foreground">
            Save as <span className="font-mono">.env.local</span> in{" "}
            <span className="font-mono">{guide.starterDir || "your agent-starter-python folder"}</span>
            . Include LiveKit keys plus STT/TTS/LLM or realtime keys. Optional{" "}
            <span className="font-mono">AGENT_ENTRYPOINT=src/agent.py</span>.
          </p>
          <CopyField label=".env.local" value={guide.envFile} multiline />
        </Step>

        <Step n={3} title="Start the worker from the starter kit">
          <p className="text-sm text-muted-foreground">
            This registers with <span className="font-mono">{guide.wsUrl}</span> using the agent
            name above. Keep this process running.
          </p>
          <CopyField label="From the starter directory" value={guide.startWorker} multiline />
          <p className="text-sm text-muted-foreground">
            Same image on Docker (uses <span className="font-mono">{guide.dockerWsUrl}</span>):
          </p>
          <CopyField label="From the Deck repo" value={guide.dockerDeploy} />
        </Step>

        <Step n={4} title="Join a room by agent name">
          <p className="text-sm text-muted-foreground">
            Use the Dispatch form below, or the CLI. The name must match{" "}
            <span className="font-mono">AGENT_NAME</span>.
          </p>
          <CopyField label="Dispatch" value={guide.dispatch} />
        </Step>
      </ol>

      <details className="rounded-md border border-border bg-muted/20 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">
          Configuration, monitoring, and logs
        </summary>
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          <p>
            Worker logs for the Docker deploy are on this page. Host{" "}
            <span className="font-mono">uv run</span> logs print in that terminal.
          </p>
          <p>
            Jobs are balanced by livekit-server. Stop the worker with Ctrl+C or{" "}
            <strong>Stop</strong> on the Worker card; in-flight rooms finish if the process drains.
          </p>
        </div>
      </details>
    </section>
  );
}
