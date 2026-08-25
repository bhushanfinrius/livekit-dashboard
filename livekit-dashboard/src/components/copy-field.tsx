"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyField({
  label,
  value,
  multiline = false,
  secret = false,
  defaultVisible,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  secret?: boolean;
  defaultVisible?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(defaultVisible ?? !secret);
  const shown = !secret || visible ? value : value ? "•".repeat(Math.min(value.length, 32)) : "";

  async function copy() {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2">
        <code
          className={cn(
            "min-w-0 flex-1 rounded-md border border-border bg-panel-2 px-2.5 py-1.5 font-mono text-xs",
            multiline ? "whitespace-pre-wrap" : "truncate",
          )}
        >
          {shown || "…"}
        </code>
        {secret ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setVisible((open) => !open)}
            disabled={!value}
            aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          >
            {visible ? <EyeOff /> : <Eye />}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => void copy()}
          disabled={!value}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}
