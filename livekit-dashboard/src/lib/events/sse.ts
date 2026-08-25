import type { LiveWebhookEvent } from "@/lib/events/types";

type Listener = (event: LiveWebhookEvent) => void;

const subscribers = new Map<string, Set<Listener>>();

export function subscribeProjectEvents(projectId: string, listener: Listener) {
  const listeners = subscribers.get(projectId) ?? new Set<Listener>();
  listeners.add(listener);
  subscribers.set(projectId, listeners);

  return () => {
    const current = subscribers.get(projectId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      subscribers.delete(projectId);
    }
  };
}

export function publishProjectEvent(projectId: string, event: LiveWebhookEvent) {
  const listeners = subscribers.get(projectId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener(event);
  }
}
