import { describe, expect, it } from "vitest";
import {
  campaignMaxConcurrent,
  campaignRoomAllowed,
  isBurstDialRoom,
} from "@/lib/egress/recording";

describe("isBurstDialRoom", () => {
  it("treats Solvox campaign and test rooms as burst dials", () => {
    expect(isBurstDialRoom("camp-17400407-bb225e9e-aa88d4981169")).toBe(true);
    expect(isBurstDialRoom("test-2e551bbd-20260904_125110_466836")).toBe(true);
    expect(isBurstDialRoom("deck-console-abc")).toBe(false);
    expect(isBurstDialRoom("support")).toBe(false);
  });
});

describe("campaignMaxConcurrent", () => {
  it("defaults to 3", () => {
    expect(campaignMaxConcurrent()).toBe(3);
  });
});

describe("campaignRoomAllowed", () => {
  it("keeps the oldest 3 campaign rooms and rejects extras", () => {
    const rooms = [
      { name: "camp-lead-a-1", creationTime: 1 },
      { name: "camp-lead-a-2", creationTime: 2 },
      { name: "camp-lead-b-1", creationTime: 3 },
      { name: "camp-lead-b-2", creationTime: 4 },
      { name: "camp-lead-c-1", creationTime: 5 },
    ];
    expect(campaignRoomAllowed("camp-lead-a-1", rooms)).toBe(true);
    expect(campaignRoomAllowed("camp-lead-a-2", rooms)).toBe(true);
    expect(campaignRoomAllowed("camp-lead-b-1", rooms)).toBe(true);
    expect(campaignRoomAllowed("camp-lead-b-2", rooms)).toBe(false);
    expect(campaignRoomAllowed("camp-lead-c-1", rooms)).toBe(false);
    expect(campaignRoomAllowed("camp-new-lead", rooms)).toBe(false);
  });

  it("does not cap Talk / console rooms", () => {
    const rooms = [
      { name: "camp-1", creationTime: 1 },
      { name: "camp-2", creationTime: 2 },
      { name: "camp-3", creationTime: 3 },
    ];
    expect(campaignRoomAllowed("deck-console-abc", rooms)).toBe(true);
  });
});
