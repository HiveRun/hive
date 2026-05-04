import type { Event } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  resolveRuntimeModeFromEvent,
  resolveRuntimeStatusFromEvent,
} from "../agents/service";

describe("resolveRuntimeStatusFromEvent", () => {
  it("returns null when user message updates", () => {
    const event = buildMessageUpdatedEvent("user");
    expect(resolveRuntimeStatusFromEvent(event)).toBeNull();
  });

  it("returns working for assistant message updates", () => {
    const event = buildMessageUpdatedEvent("assistant", {
      time: { created: Date.now(), completed: Date.now() },
    });
    expect(resolveRuntimeStatusFromEvent(event)).toEqual({ status: "working" });
  });

  it("returns awaiting_input for session idle events", () => {
    assertResolvedStatus(agentEvent("session.idle"), "awaiting_input");
  });

  it("returns awaiting_input for session status idle updates", () => {
    assertResolvedStatus(
      agentEvent("session.status", { status: { type: "idle" } }),
      "awaiting_input"
    );
  });

  it("returns working for session status busy updates", () => {
    assertResolvedStatus(
      agentEvent("session.status", { status: { type: "busy" } }),
      "working"
    );
  });

  it("returns awaiting_input for permission prompts", () => {
    assertResolvedStatus(
      agentEvent("permission.asked", {
        id: "perm_test",
        permission: "plan_exit",
        patterns: ["plan_exit"],
        metadata: {},
        always: [],
      }),
      "awaiting_input"
    );
  });

  it("returns working for permission replies", () => {
    assertResolvedStatus(
      agentEvent("permission.replied", {
        permissionID: "perm_test",
        response: "once",
      }),
      "working"
    );
  });

  it("returns awaiting_input for plan questions", () => {
    assertResolvedStatus(
      agentEvent("question.asked", {
        id: "question_test",
        text: "Continue?",
      }),
      "awaiting_input"
    );
  });

  it("returns working for answered plan questions", () => {
    assertResolvedStatus(
      agentEvent("question.replied", {
        id: "question_test",
        text: "Continue?",
        answer: "Yes",
      }),
      "working"
    );
  });

  it("returns awaiting_input for rejected plan questions", () => {
    assertResolvedStatus(
      agentEvent("question.rejected", {
        id: "question_test",
      }),
      "awaiting_input"
    );
  });

  it("returns error info for session errors", () => {
    const event: Event = {
      type: "session.error",
      properties: {
        sessionID: "ses_test",
        error: { data: { message: "boom" } },
      },
    } as unknown as Event;

    expect(resolveRuntimeStatusFromEvent(event)).toEqual({
      status: "error",
      error: "boom",
    });
  });
});

describe("resolveRuntimeModeFromEvent", () => {
  it("uses user message mode updates for no-reply prompts", () => {
    const event = buildMessageUpdatedEvent("user", { mode: "build" });
    expect(resolveRuntimeModeFromEvent(event)).toBe("build");
  });

  it("uses assistant message mode updates", () => {
    const event = buildMessageUpdatedEvent("assistant", { mode: "plan" });
    expect(resolveRuntimeModeFromEvent(event)).toBe("plan");
  });
});

function buildMessageUpdatedEvent(
  role: "user" | "assistant",
  options?: {
    mode?: "plan" | "build";
    time?: { created: number; completed?: number };
  }
): Event {
  if (role === "assistant") {
    const info = {
      id: "msg_test",
      sessionID: "ses_test",
      role: "assistant" as const,
      parentID: "msg_user",
      time: {
        created: Date.now(),
        ...options?.time,
      },
      model: {
        providerID: "provider_test",
        modelID: "model_test",
      },
      ...(options?.mode ? { mode: options.mode } : {}),
    };

    return {
      type: "message.updated",
      properties: { info },
    } as unknown as Event;
  }

  const info = {
    id: "msg_test",
    sessionID: "ses_test",
    role: "user" as const,
    time: {
      created: Date.now(),
      ...options?.time,
    },
    ...(options?.mode ? { mode: options.mode } : {}),
  } as {
    id: string;
    sessionID: string;
    role: "user";
    time: { created: number; completed?: number };
    mode?: "plan" | "build";
  };

  return {
    type: "message.updated",
    properties: { info },
  } as unknown as Event;
}

function agentEvent(
  type: string,
  properties: Record<string, unknown> = {}
): Event {
  return {
    type,
    properties: { sessionID: "ses_test", ...properties },
  } as unknown as Event;
}

function assertResolvedStatus(
  sourceEvent: Event,
  status: "awaiting_input" | "working"
) {
  const actual = resolveRuntimeStatusFromEvent(sourceEvent);
  if (actual?.status !== status || actual.error) {
    throw new Error(`Expected status ${status}, got ${JSON.stringify(actual)}`);
  }
}
