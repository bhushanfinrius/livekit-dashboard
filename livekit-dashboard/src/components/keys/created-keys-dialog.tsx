"use client";

import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/copy-field";

export function CreatedKeysDialog({
  open,
  onClose,
  apiKey,
  apiSecret,
}: {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  apiSecret: string;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="created-keys-title"
        className="relative z-[61] w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-lg"
      >
        <h2 id="created-keys-title" className="font-display text-lg font-semibold">
          Copy your API secret
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Cloud-style: the secret is shown here so you can copy it. In LumiVoice, owners can also
          copy it later from API keys — it is not discarded.
        </p>
        <div className="mt-4 space-y-3">
          <CopyField label="API key" value={apiKey} />
          <CopyField label="API secret" value={apiSecret} secret defaultVisible />
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
