import { auth } from "@/auth";
import { subscribeProjectEvents } from "@/lib/events/sse";
import type { LiveWebhookEvent } from "@/lib/events/types";
import { jsonError } from "@/lib/http";
import { getProjectLiveKit, ProjectAccessError } from "@/lib/livekit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { id } = await context.params;

  try {
    await getProjectLiveKit(session.user.id, id);
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return jsonError(error.message, error.status, error.code);
    }
    throw error;
  }

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: string) => {
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // stream already closed
        }
      };

      const shutdown = () => {
        if (ping) clearInterval(ping);
        ping = undefined;
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const onEvent = (event: LiveWebhookEvent) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
      };

      unsubscribe = subscribeProjectEvents(id, onEvent);
      send(`: connected\n\n`);
      ping = setInterval(() => send(`: ping\n\n`), 15_000);

      request.signal.addEventListener("abort", shutdown);
    },
    cancel() {
      if (ping) clearInterval(ping);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
