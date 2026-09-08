import type { V2Event } from "@opencode-ai/client";
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
    const { response, close, readChunk } =
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

    close();
  });

  it("returns 404 when session cannot be found", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockResolvedValue(null);

    const response = await requestStatusStream("missing");

    expect(response.status).toBe(HTTP_NOT_FOUND);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toBe("Agent session not found");
  });

  it("emits working as the initial restored status", async () => {
    const { response, close, readChunk } =
      await openStatusStream(TEST_WORKING_SESSION);

    expect(response.status).toBe(HTTP_OK);

    const initial = await readChunk();

    expect(initial).toContain("event: status");
    expect(initial).toContain("working");

    close();
  });

  it("emits initial mode and forwards mode updates", async () => {
    const { response, close, readChunk } = await openStatusStream(
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

    close();
  });

  it("forwards input_required events from permission prompts", async () => {
    const { close, readChunk } = await openOkStatusStream(TEST_SESSION);

    await expectInitialStatus(readChunk);

    publishAgentEvent(TEST_SESSION.id, createPermissionAskedEvent("perm_123"));

    const update = await readChunk();
    expect(update).toContain("event: input_required");
    expect(update).toContain("plan_exit");

    close();
  });

  it("subscribes before loading the initial session snapshot", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockImplementation(() => {
      publishAgentEvent(TEST_SESSION.id, {
        type: "status",
        status: "working",
      });
      return Promise.resolve(TEST_SESSION);
    });

    const controller = new AbortController();
    const response = await requestStatusStream(
      TEST_SESSION.id,
      controller.signal
    );
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

    controller.abort();
  });

  it("does not replay pending input already included in the initial snapshot", async () => {
    const pendingInput = createPendingInputEvent("perm_interleaved");
    vi.spyOn(AgentService, "fetchPendingAgentInputEvents").mockImplementation(
      () => {
        publishAgentEvent(TEST_SESSION.id, pendingInput);
        publishAgentEvent(TEST_SESSION.id, {
          type: "status",
          status: "working",
        });
        return Promise.resolve([pendingInput]);
      }
    );

    const { close, readChunk } = await openOkStatusStream(TEST_SESSION);
    await expectInitialStatus(readChunk);
    const pending = await readChunk();
    const interleaved = await readChunk();

    expect(pending).toContain("perm_interleaved");
    expect(interleaved).toContain('"status":"working"');
    expect(interleaved).not.toContain("perm_interleaved");

    close();
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

  const controller = new AbortController();
  const response = await requestStatusStream(session.id, controller.signal);
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

  return { response, readChunk, close: () => controller.abort() };
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

function requestStatusStream(sessionId: string, signal?: AbortSignal) {
  const app = new Elysia().use(agentsRoutes);
  return app.handle(
    new Request(`http://localhost/api/agents/sessions/${sessionId}/events`, {
      signal,
    })
  );
}

function createPermissionAskedEvent(
  id: string
): Extract<V2Event, { type: "permission.asked" }> {
  return {
    id: `event-${id}`,
    created: Date.now(),
    type: "permission.asked" as const,
    data: {
      id,
      sessionID: TEST_SESSION.id,
      action: "plan_exit",
      resources: ["plan_exit"],
      metadata: {},
      save: [],
    },
  };
}

function createPendingInputEvent(id: string) {
  return {
    type: "input_required" as const,
    sessionId: TEST_SESSION.id,
    permissionId: id,
    title: "plan_exit",
    kind: "permission" as const,
  };
}
