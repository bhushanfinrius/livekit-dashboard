"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Field } from "@/components/telephony/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  InboundTrunkSnapshot,
  MediaEncryption,
  OutboundTrunkSnapshot,
} from "@/lib/livekit/sip-types";
import { cn } from "@/lib/utils";

export type TrunkDirection = "inbound" | "outbound";
export type TrunkTransport = "auto" | "udp" | "tcp" | "tls";

export type TrunkFormValue = {
  name: string;
  direction: TrunkDirection;
  address: string;
  transport: TrunkTransport;
  numbers: string;
  allowedAddresses: string;
  allowedNumbers: string;
  authUsername: string;
  authPassword: string;
  mediaEncryption: MediaEncryption;
  krispEnabled: boolean;
};

const EMPTY: TrunkFormValue = {
  name: "",
  direction: "outbound",
  address: "",
  transport: "tls",
  numbers: "",
  allowedAddresses: "",
  allowedNumbers: "",
  authUsername: "",
  authPassword: "",
  mediaEncryption: "disable",
  krispEnabled: false,
};

function fromTrunk(
  trunk: InboundTrunkSnapshot | OutboundTrunkSnapshot,
  direction: TrunkDirection,
): TrunkFormValue {
  const outbound = direction === "outbound" ? (trunk as OutboundTrunkSnapshot) : null;
  const inbound = direction === "inbound" ? (trunk as InboundTrunkSnapshot) : null;
  return {
    ...EMPTY,
    name: trunk.name,
    direction,
    address: outbound?.address ?? "",
    transport: (outbound?.transport as TrunkTransport) || "auto",
    numbers: trunk.numbers.join(", "),
    allowedAddresses: inbound?.allowedAddresses.join(", ") ?? "",
    allowedNumbers: inbound?.allowedNumbers.join(", ") ?? "",
    authUsername: trunk.authUsername,
    authPassword: "",
    mediaEncryption: trunk.mediaEncryption,
    krispEnabled: inbound?.krispEnabled ?? false,
  };
}

function toApiBody(value: TrunkFormValue): Record<string, unknown> {
  if (value.direction === "inbound") {
    return {
      name: value.name,
      numbers: value.numbers,
      allowedAddresses: value.allowedAddresses,
      allowedNumbers: value.allowedNumbers,
      authUsername: value.authUsername,
      authPassword: value.authPassword,
      mediaEncryption: value.mediaEncryption,
      krispEnabled: value.krispEnabled,
    };
  }
  return {
    name: value.name,
    address: value.address,
    numbers: value.numbers,
    transport: value.transport,
    authUsername: value.authUsername,
    authPassword: value.authPassword,
    mediaEncryption: value.mediaEncryption,
  };
}

export function CreateTrunkSheet({
  open,
  onOpenChange,
  pending,
  error,
  editing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error?: string | null;
  editing?: { direction: TrunkDirection; trunk: InboundTrunkSnapshot | OutboundTrunkSnapshot } | null;
  onSubmit: (direction: TrunkDirection, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<"details" | "json">("details");
  const [optionalOpen, setOptionalOpen] = useState(true);
  const [value, setValue] = useState<TrunkFormValue>(EMPTY);
  const [jsonText, setJsonText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const lockedDirection = Boolean(editing);

  useEffect(() => {
    if (!open) return;
    const next = editing ? fromTrunk(editing.trunk, editing.direction) : EMPTY;
    setValue(next);
    setJsonText(JSON.stringify(toApiBody(next), null, 2));
    setTab("details");
    setOptionalOpen(true);
    setLocalError(null);
  }, [open, editing]);

  const apiBody = useMemo(() => toApiBody(value), [value]);

  function patch(partial: Partial<TrunkFormValue>) {
    setValue((current) => {
      const next = { ...current, ...partial };
      setJsonText(JSON.stringify(toApiBody(next), null, 2));
      return next;
    });
  }

  async function submit() {
    setLocalError(null);
    let body: Record<string, unknown> = apiBody;
    if (tab === "json") {
      try {
        body = JSON.parse(jsonText) as Record<string, unknown>;
      } catch {
        setLocalError("JSON is not valid.");
        return;
      }
    }
    const ok = await onSubmit(value.direction, body);
    if (!ok) return;
    setValue(EMPTY);
    onOpenChange(false);
  }

  const selectClass =
    "native-select h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col overflow-hidden p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Trunk details</SheetTitle>
          <SheetDescription>
            Creates or updates a trunk on livekit-server with the same SIP APIs as{" "}
            <span className="font-mono">lk sip</span>.
          </SheetDescription>
        </SheetHeader>

        <div className="flex gap-1 border-b border-border px-4">
          {(
            [
              ["details", "Trunk details"],
              ["json", "JSON editor"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (id === "json") setJsonText(JSON.stringify(apiBody, null, 2));
                setTab(id);
              }}
              className={cn(
                "px-3 py-2 text-sm font-medium",
                tab === id
                  ? "border-b-2 border-live text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {tab === "details" ? (
            <div className="flex flex-col gap-4">
              <Field
                id="trunk-name"
                label="Trunk name"
                required
                placeholder="My trunk"
                value={value.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Trunk direction</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["inbound", "outbound"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={lockedDirection}
                      onClick={() => patch({ direction: option })}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm capitalize",
                        value.direction === option
                          ? "border-live text-foreground"
                          : "border-border text-muted-foreground",
                        lockedDirection && "opacity-70",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              {value.direction === "outbound" ? (
                <>
                  <Field
                    id="out-address"
                    label="Address"
                    required
                    placeholder="sip.provider.com"
                    value={value.address}
                    onChange={(event) => patch({ address: event.target.value })}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="out-transport">Transport</Label>
                    <select
                      id="out-transport"
                      className={selectClass}
                      value={value.transport}
                      onChange={(event) => patch({ transport: event.target.value as TrunkTransport })}
                    >
                      <option value="auto">AUTO</option>
                      <option value="udp">UDP</option>
                      <option value="tcp">TCP</option>
                      <option value="tls">TLS</option>
                    </select>
                  </div>
                </>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="trunk-numbers">Numbers</Label>
                <textarea
                  id="trunk-numbers"
                  required
                  rows={3}
                  placeholder="+15551234567, +15557654321"
                  value={value.numbers}
                  onChange={(event) => patch({ numbers: event.target.value })}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm dark:bg-input/30"
                />
              </div>

              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium"
                onClick={() => setOptionalOpen((open) => !open)}
              >
                <ChevronDown className={cn("size-4 transition-transform", optionalOpen ? "rotate-0" : "-rotate-90")} />
                Optional settings
              </button>

              {optionalOpen ? (
                <div className="flex flex-col gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="media-encryption">Media encryption (SRTP)</Label>
                    <select
                      id="media-encryption"
                      className={selectClass}
                      value={value.mediaEncryption}
                      onChange={(event) =>
                        patch({ mediaEncryption: event.target.value as MediaEncryption })
                      }
                    >
                      <option value="disable">Disable</option>
                      <option value="allow">Allow if available</option>
                      <option value="require">Require encryption</option>
                    </select>
                  </div>
                  {value.direction === "inbound" ? (
                    <>
                      <Field
                        id="in-allowed-ip"
                        label="Allowed addresses"
                        placeholder="1.2.3.4/32"
                        value={value.allowedAddresses}
                        onChange={(event) => patch({ allowedAddresses: event.target.value })}
                      />
                      <Field
                        id="in-allowed-num"
                        label="Allowed caller numbers"
                        value={value.allowedNumbers}
                        onChange={(event) => patch({ allowedNumbers: event.target.value })}
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={value.krispEnabled}
                          onChange={(event) => patch({ krispEnabled: event.target.checked })}
                        />
                        Krisp noise cancellation
                      </label>
                    </>
                  ) : null}
                  <Field
                    id="auth-user"
                    label="Username"
                    autoComplete="off"
                    value={value.authUsername}
                    onChange={(event) => patch({ authUsername: event.target.value })}
                  />
                  <Field
                    id="auth-pass"
                    type="password"
                    label="Password"
                    autoComplete="new-password"
                    placeholder={editing ? "Leave blank to keep" : undefined}
                    value={value.authPassword}
                    onChange={(event) => patch({ authPassword: event.target.value })}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <textarea
              aria-label="Trunk JSON"
              className="min-h-[320px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs dark:bg-input/30"
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
            />
          )}
          {localError || error ? (
            <p className="mt-3 text-sm text-destructive">{localError ?? error}</p>
          ) : null}
        </div>

        <SheetFooter className="border-t border-border">
          <a
            href="https://docs.livekit.io/sip/trunks/"
            target="_blank"
            rel="noreferrer"
            className="mr-auto text-xs text-muted-foreground hover:text-foreground"
          >
            Learn more in the docs
          </a>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={pending} onClick={() => void submit()}>
            {pending ? "Saving…" : editing ? "Update" : "Create"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
