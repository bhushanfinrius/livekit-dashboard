"use client";

import { useState } from "react";
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

export function CreateDispatchSheet({
  open,
  onOpenChange,
  pending,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onCreate: (payload: Record<string, FormDataEntryValue | null>) => Promise<boolean>;
}) {
  const [type, setType] = useState("direct");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Dispatch rule details</SheetTitle>
          <SheetDescription>
            Route inbound SIP calls to a room or prefix based on the trunk they arrive on.
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex flex-1 flex-col gap-4 px-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void onCreate({
              name: data.get("name"),
              type: data.get("type"),
              roomName: data.get("roomName"),
              roomPrefix: data.get("roomPrefix"),
              pin: data.get("pin"),
              trunkIds: data.get("trunkIds"),
            }).then((ok) => {
              if (!ok) return;
              form.reset();
              setType("direct");
              onOpenChange(false);
            });
          }}
        >
          <Field id="rule-name" name="name" label="Rule name" required placeholder="My rule" />
          <div className="space-y-1.5">
            <Label htmlFor="rule-type">Rule type</Label>
            <select
              id="rule-type"
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="native-select h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm dark:bg-input/30"
            >
              <option value="direct">direct (existing room)</option>
              <option value="individual">individual (new room per caller)</option>
              <option value="callee">callee (new room per callee)</option>
            </select>
          </div>
          {type === "direct" ? (
            <Field id="rule-room" name="roomName" label="Room name" required placeholder="support" />
          ) : (
            <Field id="rule-prefix" name="roomPrefix" label="Room prefix" required placeholder="call-" />
          )}
          <Field id="rule-pin" name="pin" label="PIN (optional)" />
          <Field
            id="rule-trunks"
            name="trunkIds"
            label="Trunk IDs (comma-separated, optional)"
            placeholder="ST_xxx, ST_yyy"
          />
          <p className="text-xs text-muted-foreground">
            Empty trunk list means the rule matches every inbound trunk.
          </p>
          <SheetFooter className="px-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
