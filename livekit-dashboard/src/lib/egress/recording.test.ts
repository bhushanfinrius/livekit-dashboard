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
  it("allows 3 distinct leads and drops extra rooms for the same lead", () => {
    const rooms = [
      { name: "camp-17400407-bb225e9e-aaaaaa111111", creationTime: 1, numParticipants: 1 },
      { name: "camp-17400407-bb225e9e-bbbbbb222222", creationTime: 2, numParticipants: 1 },
      { name: "camp-17400407-bb225e9e-cccccc333333", creationTime: 3, numParticipants: 1 },
      { name: "camp-17400407-0911723d-dddddd444444", creationTime: 4, numParticipants: 1 },
      { name: "camp-17400407-5b78f8f0-eeeeee555555", creationTime: 5, numParticipants: 1 },
    ];
    expect(campaignRoomAllowed("camp-17400407-bb225e9e-cccccc333333", rooms)).toBe(true);
    expect(campaignRoomAllowed("camp-17400407-bb225e9e-aaaaaa111111", rooms)).toBe(false);
    expect(campaignRoomAllowed("camp-17400407-0911723d-dddddd444444", rooms)).toBe(true);
    expect(campaignRoomAllowed("camp-17400407-5b78f8f0-eeeeee555555", rooms)).toBe(true);
  });

  it("allows a fourth lead so leftover rooms cannot block a new caller", () => {
    const rooms = [
      { name: "camp-17400407-11111111-aaaaaa111111", creationTime: 1, numParticipants: 1 },
      { name: "camp-17400407-22222222-bbbbbb222222", creationTime: 2, numParticipants: 1 },
      { name: "camp-17400407-33333333-cccccc333333", creationTime: 3, numParticipants: 1 },
      { name: "camp-17400407-44444444-dddddd444444", creationTime: 4, numParticipants: 1 },
    ];
    expect(campaignRoomAllowed("camp-17400407-44444444-dddddd444444", rooms)).toBe(true);
  });

  it("never blocks a Solvox test room even when 3 campaign rooms are live", () => {
    const rooms = [
      { name: "camp-17400407-11111111-aaaaaa111111", creationTime: 1, numParticipants: 1 },
      { name: "camp-17400407-22222222-bbbbbb222222", creationTime: 2, numParticipants: 1 },
      { name: "camp-17400407-33333333-cccccc333333", creationTime: 3, numParticipants: 1 },
    ];
    expect(campaignRoomAllowed("test-2e551bbd-20260904_125110_466836", rooms)).toBe(true);
  });

  it("does not cap Talk / console rooms", () => {
    const rooms = [
      { name: "camp-17400407-11111111-aaaaaa111111", creationTime: 1, numParticipants: 1 },
      { name: "camp-17400407-22222222-bbbbbb222222", creationTime: 2, numParticipants: 1 },
      { name: "camp-17400407-33333333-cccccc333333", creationTime: 3, numParticipants: 1 },
    ];
    expect(campaignRoomAllowed("deck-console-abc", rooms)).toBe(true);
  });
});
