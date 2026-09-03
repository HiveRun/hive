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

const TEST_WORKING_SESSION: AgentSessionRecord = {
  ...TEST_SESSION,
  status: "working",
};

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;

describe("agent status stream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AgentService, "fetchAgentSession").mockResolvedValue(null);
    vi.spyOn(AgentService, "fetchPendingAgentInputEvents").mockResolvedValue(
      []
    );
  });

  it("emits initial status and forwards status updates", async () => {
    const { response, reader, readChunk } =
      await openOkStatusStream(TEST_SESSION);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

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

    const response = await requestStatusStream("missing");

    expect(response.status).toBe(HTTP_NOT_FOUND);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toBe("Agent session not found");
  });

  it("emits working as the initial restored status", async () => {
    const { response, reader, readChunk } =
      await openStatusStream(TEST_WORKING_SESSION);

    expect(response.status).toBe(HTTP_OK);

    const initial = await readChunk();

    expect(initial).toContain("event: status");
    expect(initial).toContain("working");

    await reader.cancel();
  });

  it("emits initial mode and forwards mode updates", async () => {
    const { response, reader, readChunk } = await openStatusStream(
      TEST_SESSION_WITH_MODE
    );

    expect(response.status).toBe(HTTP_OK);

    await expectInitialStatus(readChunk);

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
    const { reader, readChunk } = await openOkStatusStream(TEST_SESSION);

    await expectInitialStatus(readChunk);

    publishAgentEvent(
      TEST_SESSION.id,
      createPermissionAskedEvent("perm_123") as never
    );

    const update = await readChunk();
    expect(update).toContain("event: input_required");
    expect(update).toContain("plan_exit");

    await reader.cancel();
  });

  it("subscribes before loading the initial session snapshot", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockImplementation(() => {
      publishAgentEvent(TEST_SESSION.id, {
        type: "status",
        status: "working",
      });
      return Promise.resolve(TEST_SESSION);
    });

    const response = await requestStatusStream(TEST_SESSION.id);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected event stream body");
    }
    const decoder = new TextDecoder();
    const readText = async () => {
      const value = (await reader.read()).value;
      if (typeof value === "string") {
        return value;
      }
      return value instanceof Uint8Array ? decoder.decode(value) : "";
    };
    const initial = await readText();
    const interleaved = await readText();

    expect(initial).toContain("awaiting_input");
    expect(interleaved).toContain("working");

    await reader.cancel();
  });

  it("does not replay pending input already included in the initial snapshot", async () => {
    const pendingInput = createPermissionAskedEvent("perm_interleaved");
    vi.spyOn(AgentService, "fetchPendingAgentInputEvents").mockImplementation(
      () => {
        publishAgentEvent(TEST_SESSION.id, pendingInput as never);
        publishAgentEvent(TEST_SESSION.id, {
          type: "status",
          status: "working",
        });
        return Promise.resolve([pendingInput as never]);
      }
    );

    const { reader, readChunk } = await openOkStatusStream(TEST_SESSION);
    await expectInitialStatus(readChunk);
    const pending = await readChunk();
    const interleaved = await readChunk();

    expect(pending).toContain("perm_interleaved");
    expect(interleaved).toContain('"status":"working"');
    expect(interleaved).not.toContain("perm_interleaved");

    await reader.cancel();
  });

  it("returns transport failures instead of reporting a missing session", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockRejectedValue(
      new Error("connection reset")
    );

    const response = await requestStatusStream(TEST_SESSION.id);

    expect(response.status).toBe(HTTP_BAD_REQUEST);
    await expect(response.json()).resolves.toEqual({
      message: "connection reset",
    });
  });
});

async function openStatusStream(session: AgentSessionRecord) {
  vi.spyOn(AgentService, "fetchAgentSession").mockImplementation(
    async (id: string) => (id === session.id ? session : null)
  );

  const response = await requestStatusStream(session.id);
  const reader = response.body?.getReader() as
    | ReadableStreamDefaultReader<Uint8Array>
    | undefined;
  if (!reader) {
    throw new Error("Expected event stream body");
  }

  const decoder = new TextDecoder();
  const readChunk = async () => {
    const next = (await reader.read()) as ReadableStreamReadResult<unknown>;
    if (typeof next.value === "string") {
      return next.value;
    }
    if (next.value instanceof Uint8Array) {
      return decoder.decode(next.value);
    }
    return "";
  };

  return { response, reader, readChunk };
}

async function openOkStatusStream(session: AgentSessionRecord) {
  const stream = await openStatusStream(session);
  if (stream.response.status !== HTTP_OK) {
    throw new Error(
      `Expected status ${HTTP_OK}, got ${stream.response.status}`
    );
  }
  return stream;
}

async function expectInitialStatus(readChunk: () => Promise<string>) {
  const initialStatus = await readChunk();
  if (!initialStatus.includes("event: status")) {
    throw new Error(`Expected status event, got ${initialStatus}`);
  }
}

function requestStatusStream(sessionId: string) {
  const app = new Elysia().use(agentsRoutes);
  return app.handle(
    new Request(`http://localhost/api/agents/sessions/${sessionId}/events`)
  );
}

function createPermissionAskedEvent(id: string) {
  return {
    type: "permission.asked" as const,
    properties: {
      id,
      sessionID: TEST_SESSION.id,
      permission: "plan_exit",
      patterns: ["plan_exit"],
      metadata: {},
      always: [],
    },
  };
}
