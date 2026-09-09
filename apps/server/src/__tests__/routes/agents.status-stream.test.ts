import { Elysia } from "elysia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishAgentEvent } from "../../agents/events";
// biome-ignore lint/performance/noNamespaceImport: vi.spyOn requires a module namespace reference
import * as AgentService from "../../agents/service";
import type { AgentSessionRecord, AgentStreamEvent } from "../../agents/types";
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

  it.each([
    {
      name: "awaiting input",
      session: TEST_SESSION,
      expected: "awaiting_input",
    },
    {
      name: "working",
      session: TEST_WORKING_SESSION,
      expected: "working",
    },
  ])("emits $name as the initial status", async ({ session, expected }) => {
    const { response, close, readChunk } = await openOkStatusStream(session);

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const initial = await readChunk();
    expect(initial).toContain("event: status");
    expect(initial).toContain(expected);

    close();
  });

  it("returns 404 when session cannot be found", async () => {
    vi.spyOn(AgentService, "fetchAgentSession").mockResolvedValue(null);

    const response = await requestStatusStream("missing");

    expect(response.status).toBe(HTTP_NOT_FOUND);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toBe("Agent session not found");
  });

  it.each([
    {
      name: "status updates",
      session: TEST_SESSION,
      initialMode: undefined,
      event: { type: "status", status: "working" },
      expected: ["event: status", '"status":"working"'],
    },
    {
      name: "mode updates",
      session: TEST_SESSION_WITH_MODE,
      initialMode: "plan",
      event: {
        type: "mode",
        startMode: "plan",
        currentMode: "build",
        modeUpdatedAt: new Date().toISOString(),
      },
      expected: ["event: mode", '"currentMode":"build"'],
    },
    {
      name: "input-required updates",
      session: TEST_SESSION,
      initialMode: undefined,
      event: createPendingInputEvent("perm_123"),
      expected: [
        "event: input_required",
        `"sessionId":"${TEST_SESSION.id}"`,
        '"permissionId":"perm_123"',
        '"title":"plan_exit"',
        '"kind":"permission"',
      ],
    },
  ] satisfies readonly {
    name: string;
    session: AgentSessionRecord;
    initialMode: "plan" | undefined;
    event: AgentStreamEvent;
    expected: string[];
  }[])(
    "forwards $name using the Hive stream contract",
    async ({ session, initialMode, event, expected }) => {
      const { close, readChunk } = await openOkStatusStream(session);

      await expectInitialStatus(readChunk);
      if (initialMode) {
        const initial = await readChunk();
        expect(initial).toContain("event: mode");
        expect(initial).toContain(`"currentMode":"${initialMode}"`);
      }

      publishAgentEvent(TEST_SESSION.id, event);

      const update = await readChunk();
      for (const fragment of expected) {
        expect(update).toContain(fragment);
      }

      close();
    }
  );

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

function createPendingInputEvent(
  id: string
): Extract<AgentStreamEvent, { type: "input_required" }> {
  return {
    type: "input_required" as const,
    sessionId: TEST_SESSION.id,
    permissionId: id,
    title: "plan_exit",
    kind: "permission" as const,
  };
}
