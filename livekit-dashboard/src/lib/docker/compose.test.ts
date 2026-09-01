import { afterEach, describe, expect, it } from "vitest";
import {
  agentBuildContextForCompose,
  COMPOSE_AGENT_BUILD_CONTEXT,
} from "@/lib/docker/compose";
import { credentialMountHostPath } from "@/lib/livekit/agent-worker";

describe("agentBuildContextForCompose", () => {
  afterEach(() => {
    delete process.env.DECK_IN_COMPOSE;
    delete process.env.COMPOSE_PROJECT_DIR;
    delete process.env.AGENT_BUILD_CONTEXT;
  });

  it("uses relative context when LumiVoice runs in deck", () => {
    process.env.DECK_IN_COMPOSE = "1";
    expect(agentBuildContextForCompose()).toBe(COMPOSE_AGENT_BUILD_CONTEXT);
  });

  it("uses relative context when compose project dir is set", () => {
    process.env.COMPOSE_PROJECT_DIR = "/compose";
    expect(agentBuildContextForCompose()).toBe(COMPOSE_AGENT_BUILD_CONTEXT);
  });

  it("uses configured host path for npm run dev", () => {
    process.env.AGENT_BUILD_CONTEXT = "C:/agents/starter";
    expect(agentBuildContextForCompose()).toBe("C:/agents/starter");
  });
});

describe("credentialMountHostPath", () => {
  afterEach(() => {
    delete process.env.AGENT_STARTER_MOUNT;
    delete process.env.COMPOSE_PROJECT_DIR;
  });

  it("maps starter mount paths to compose-relative bind mounts", () => {
    process.env.AGENT_STARTER_MOUNT = "/agent-starter";
    expect(credentialMountHostPath("/agent-starter/solvoxai.json")).toBe(
      "./agent-starter-python/solvoxai.json",
    );
  });
});
