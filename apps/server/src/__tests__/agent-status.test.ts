import type { Event } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import { resolveRuntimeStatusFromEvent } from "../agents/service";

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
    const event: Event = {
      type: "session.idle",
      properties: { sessionID: "ses_test" },
    } as unknown as Event;
    expect(resolveRuntimeStatusFromEvent(event)).toEqual({
      status: "awaiting_input",
    });
  });

  it("returns awaiting_input for session status idle updates", () => {
    const event: Event = {
      type: "session.status",
      properties: { sessionID: "ses_test", status: { type: "idle" } },
    } as unknown as Event;

    expect(resolveRuntimeStatusFromEvent(event)).toEqual({
      status: "awaiting_input",
    });
  });

  it("returns working for session status busy updates", () => {
    const event: Event = {
      type: "session.status",
      properties: { sessionID: "ses_test", status: { type: "busy" } },
    } as unknown as Event;

    expect(resolveRuntimeStatusFromEvent(event)).toEqual({
      status: "working",
    });
  });

  it("returns awaiting_input for permission prompts", () => {
    const event: Event = {
      type: "permission.asked",
      properties: {
        id: "perm_test",
        sessionID: "ses_test",
        permission: "plan_exit",
        patterns: ["plan_exit"],
        metadata: {},
        always: [],
      },
    } as unknown as Event;

    expect(resolveRuntimeStatusFromEvent(event)).toEqual({
      status: "awaiting_input",
    });
  });

  it("returns working for permission replies", () => {
    const event: Event = {
      type: "permission.replied",
      properties: {
        sessionID: "ses_test",
        permissionID: "perm_test",
        response: "once",
      },
    } as unknown as Event;

    expect(resolveRuntimeStatusFromEvent(event)).toEqual({
      status: "working",
    });
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

function buildMessageUpdatedEvent(
  role: "user" | "assistant",
  options?: { time?: { created: number; completed?: number } }
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
  } as {
    id: string;
    sessionID: string;
    role: "user";
    time: { created: number; completed?: number };
  };

  return {
    type: "message.updated",
    properties: { info },
  } as unknown as Event;
}
