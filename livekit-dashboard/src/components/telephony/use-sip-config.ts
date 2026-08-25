"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson } from "@/lib/api/client";
import type {
  DispatchRuleSnapshot,
  InboundTrunkSnapshot,
  OutboundTrunkSnapshot,
} from "@/lib/livekit/sip-types";

export type SipPayload = {
  inbound: InboundTrunkSnapshot[];
  outbound: OutboundTrunkSnapshot[];
  dispatch: DispatchRuleSnapshot[];
};

export function useSipConfig(projectId: string) {
  const [data, setData] = useState<SipPayload>({ inbound: [], outbound: [], dispatch: [] });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    const payload = await apiJson<SipPayload>(`/api/projects/${projectId}/sip`);
    setData(payload);
    setError(null);
  }, [projectId]);

  useEffect(() => {
    void load()
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : "Could not load SIP config");
      })
      .finally(() => setReady(true));
  }, [load]);

  async function run(key: string, work: () => Promise<void>) {
    setPending(key);
    setError(null);
    try {
      await work();
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed");
      return false;
    } finally {
      setPending(null);
    }
  }

  return { data, error, setError, ready, pending, run, load };
}
