import { Elysia } from "elysia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishAgentEvent } from "../../agents/events";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as AgentService from "../../agents/service";
import type { AgentSessionRecord } from "../../agents/types";
import { agentsRoutes } from "../../routes/agents";

const TEST_SESSION: AgentSessionRecord = {
  id: "session-status-test",
  cellId: "cell-status-test",
  templateId: "template-status-test",
  provider: "opencode",
  status: "awaiting_input",
  workspacePath: "/tmp/workspace",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const TEST_SESSION_WITH_MODE: AgentSessionRecord = {
  ...TEST_SESSION,
  startMode: "plan",
  currentMode: "plan",
  modeUpdatedAt: new Date().toISOString(),
};

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

describe("agent status stream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AgentService, "fetchAgentSession").mockResolvedValue(null);
  });

  it("emits initial status and forwards status updates", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockImplementation(
      async (id: string) => (id === TEST_SESSION.id ? TEST_SESSION : null)
    );

    const app = new Elysia().use(agentsRoutes);
    const response = await app.handle(
      new Request(
        `http://localhost/api/agents/sessions/${TEST_SESSION.id}/events`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Expected event stream body");
    }

    const decoder = new TextDecoder();
    const decodeChunk = (value: unknown): string => {
      if (typeof value === "string") {
        return value;
      }
      if (value instanceof Uint8Array) {
        return decoder.decode(value);
      }
      if (value instanceof ArrayBuffer) {
        return decoder.decode(new Uint8Array(value));
      }
      return "";
    };

    const readChunk = async () => {
      const next = await reader.read();
      return decodeChunk(next.value);
    };

    const initial = await readChunk();
    expect(initial).toContain("event: status");
    expect(initial).toContain("awaiting_input");

    publishAgentEvent(TEST_SESSION.id, {
      type: "status",
      status: "working",
    });

    const update = await readChunk();
    expect(update).toContain("event: status");
    expect(update).toContain("working");

    await reader.cancel();
  });

  it("returns 404 when session cannot be found", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockResolvedValue(null);

    const app = new Elysia().use(agentsRoutes);
    const response = await app.handle(
      new Request("http://localhost/api/agents/sessions/missing/events")
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toBe("Agent session not found");
  });

  it("emits initial mode and forwards mode updates", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockImplementation(
      async (id: string) =>
        id === TEST_SESSION.id ? TEST_SESSION_WITH_MODE : null
    );

    const app = new Elysia().use(agentsRoutes);
    const response = await app.handle(
      new Request(
        `http://localhost/api/agents/sessions/${TEST_SESSION.id}/events`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Expected event stream body");
    }

    const decoder = new TextDecoder();
    const readChunk = async () => {
      const next = await reader.read();
      const value = next.value;
      if (typeof value === "string") {
        return value;
      }
      if (value instanceof Uint8Array) {
        return decoder.decode(value);
      }
      if (value instanceof ArrayBuffer) {
        return decoder.decode(new Uint8Array(value));
      }
      return "";
    };

    const initialStatus = await readChunk();
    expect(initialStatus).toContain("event: status");

    const initialMode = await readChunk();
    expect(initialMode).toContain("event: mode");
    expect(initialMode).toContain('"currentMode":"plan"');

    publishAgentEvent(TEST_SESSION.id, {
      type: "mode",
      startMode: "plan",
      currentMode: "build",
      modeUpdatedAt: new Date().toISOString(),
    });

    const update = await readChunk();
    expect(update).toContain("event: mode");
    expect(update).toContain('"currentMode":"build"');

    await reader.cancel();
  });

  it("forwards input_required events from permission prompts", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockImplementation(
      async (id: string) => (id === TEST_SESSION.id ? TEST_SESSION : null)
    );

    const app = new Elysia().use(agentsRoutes);
    const response = await app.handle(
      new Request(
        `http://localhost/api/agents/sessions/${TEST_SESSION.id}/events`
      )
    );

    expect(response.status).toBe(HTTP_OK);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      throw new Error("Expected event stream body");
    }

    const decoder = new TextDecoder();
    const readChunk = async () => {
      const next = await reader.read();
      const value = next.value;
      if (typeof value === "string") {
        return value;
      }
      if (value instanceof Uint8Array) {
        return decoder.decode(value);
      }
      if (value instanceof ArrayBuffer) {
        return decoder.decode(new Uint8Array(value));
      }
      return "";
    };

    const initialStatus = await readChunk();
    expect(initialStatus).toContain("event: status");

    publishAgentEvent(TEST_SESSION.id, {
      type: "permission.asked",
      properties: {
        id: "perm_123",
        sessionID: TEST_SESSION.id,
        permission: "plan_exit",
        patterns: ["plan_exit"],
        metadata: {},
        always: [],
      },
    } as never);

    const update = await readChunk();
    expect(update).toContain("event: input_required");
    expect(update).toContain("plan_exit");

    await reader.cancel();
  });
});
