import { Effect } from "effect";
import { Elysia } from "elysia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishAgentEvent } from "../../agents/events";
import { AgentRuntimeServiceTag } from "../../agents/service";
import type { AgentSessionRecord } from "../../agents/types";
import { LoggerService } from "../../logger";
import { agentsRoutes } from "../../routes/agents";

type RuntimeMocks = {
  logger: {
    debug: () => Effect.Effect<void>;
    info: () => Effect.Effect<void>;
    warn: () => Effect.Effect<void>;
    error: () => Effect.Effect<void>;
    child: () => RuntimeMocks["logger"];
  };
  agentRuntime: {
    fetchAgentSession: ReturnType<typeof vi.fn>;
  };
};

let runtimeMocks: RuntimeMocks | null = null;

function getRuntimeMocks(): RuntimeMocks {
  if (runtimeMocks) {
    return runtimeMocks;
  }

  const logger: RuntimeMocks["logger"] = {
    debug: () => Effect.void,
    info: () => Effect.void,
    warn: () => Effect.void,
    error: () => Effect.void,
    child: () => logger,
  };

  runtimeMocks = {
    logger,
    agentRuntime: {
      fetchAgentSession: vi.fn(),
    },
  };

  return runtimeMocks;
}

vi.mock("../../runtime", () => ({
  runServerEffect: (effect: any) => {
    const mocks = getRuntimeMocks();

    return Effect.runPromise(
      effect.pipe(
        Effect.provideService(
          AgentRuntimeServiceTag,
          mocks.agentRuntime as any
        ),
        Effect.provideService(LoggerService, mocks.logger as any)
      )
    );
  },
}));

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

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

describe("agent status stream", () => {
  beforeEach(() => {
    getRuntimeMocks().agentRuntime.fetchAgentSession.mockReset();
  });

  it("emits initial status and forwards status updates", async () => {
    getRuntimeMocks().agentRuntime.fetchAgentSession.mockImplementation(
      (id: string) =>
        Effect.succeed(id === TEST_SESSION.id ? TEST_SESSION : null)
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
    getRuntimeMocks().agentRuntime.fetchAgentSession.mockImplementation(() =>
      Effect.succeed(null)
    );

    const app = new Elysia().use(agentsRoutes);
    const response = await app.handle(
      new Request("http://localhost/api/agents/sessions/missing/events")
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
    const payload = (await response.json()) as { message: string };
    expect(payload.message).toBe("Agent session not found");
  });
});
