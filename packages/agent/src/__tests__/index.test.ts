import { beforeEach, describe, expect, it } from "vitest";
import { createAgentOrchestrator } from "../index";
import type { AgentOrchestrator, AgentSession } from "../types";

let orchestrator: AgentOrchestrator;

beforeEach(() => {
  orchestrator = createAgentOrchestrator();
});

describe("createAgentOrchestrator", () => {
  it("creates an orchestrator instance", () => {
    expect(orchestrator).toBeDefined();
  });
});

describe("createSession", () => {
  it("creates a new agent session", async () => {
    const session = await orchestrator.createSession({
      constructId: "test-construct",
      provider: "anthropic",
      prompt: "Test prompt",
    });

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.constructId).toBe("test-construct");
    expect(session.provider).toBe("anthropic");
  });

  it("initializes session with starting status", async () => {
    const session = await orchestrator.createSession({
      constructId: "test-construct",
      provider: "anthropic",
      prompt: "Test prompt",
    });

    expect(session.status).toBe("starting");
  });
});

describe("getSession", () => {
  it("retrieves an existing session", async () => {
    const created = await orchestrator.createSession({
      constructId: "test-construct",
      provider: "anthropic",
      prompt: "Test prompt",
    });

    const retrieved = await orchestrator.getSession(created.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(created.id);
  });

  it("returns null for non-existent session", async () => {
    const session = await orchestrator.getSession("non-existent");
    expect(session).toBeNull();
  });
});

describe("listSessions", () => {
  it("lists sessions for a construct", async () => {
    await orchestrator.createSession({
      constructId: "construct-1",
      provider: "anthropic",
      prompt: "Test 1",
    });

    await orchestrator.createSession({
      constructId: "construct-1",
      provider: "anthropic",
      prompt: "Test 2",
    });

    await orchestrator.createSession({
      constructId: "construct-2",
      provider: "anthropic",
      prompt: "Test 3",
    });

    const sessions = await orchestrator.listSessions("construct-1");

    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.constructId === "construct-1")).toBe(true);
  });

  it("returns empty array for construct with no sessions", async () => {
    const sessions = await orchestrator.listSessions("non-existent");
    expect(sessions).toEqual([]);
  });
});

describe("AgentSession", () => {
  let session: AgentSession;

  beforeEach(async () => {
    session = await orchestrator.createSession({
      constructId: "test-construct",
      provider: "anthropic",
      prompt: "Test prompt",
    });
  });

  it("sends and receives messages", async () => {
    await session.sendMessage("Hello, agent!");

    const messages = await session.getMessages();

    expect(messages.some((m) => m.content === "Hello, agent!")).toBe(true);
  });

  it("notifies on status changes", async () => {
    const statuses: string[] = [];

    session.onStatusChange((status) => {
      statuses.push(status);
    });

    await session.sendMessage("Test");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(statuses.length).toBeGreaterThan(0);
  });

  it("notifies on new messages", async () => {
    const messages: string[] = [];

    session.onMessage((message) => {
      messages.push(message.content);
    });

    await session.sendMessage("Test message");
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(messages.some((m) => m.includes("Test message"))).toBe(true);
  });

  it("can be stopped", async () => {
    await session.stop();
    expect(session.status).toBe("completed");
  });
});

describe("terminateSession", () => {
  it("terminates and removes a session", async () => {
    const session = await orchestrator.createSession({
      constructId: "test-construct",
      provider: "anthropic",
      prompt: "Test prompt",
    });

    await orchestrator.terminateSession(session.id);

    const retrieved = await orchestrator.getSession(session.id);
    expect(retrieved).toBeNull();
  });
});
