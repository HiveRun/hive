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
    } as Event;
    expect(resolveRuntimeStatusFromEvent(event)).toEqual({
      status: "awaiting_input",
    });
  });

  it("returns error info for session errors", () => {
    const event: Event = {
      type: "session.error",
      properties: {
        sessionID: "ses_test",
        error: { data: { message: "boom" } },
      },
    } as Event;

    expect(resolveRuntimeStatusFromEvent(event)).toEqual({
      status: "error",
      error: "boom",
    });
  });
});

type MessageUpdatedEvent = Extract<Event, { type: "message.updated" }>;
type MessageUpdatedInfo = MessageUpdatedEvent["properties"]["info"];
type UserMessageInfo = Extract<MessageUpdatedInfo, { role: "user" }>;
type AssistantMessageInfo = Extract<MessageUpdatedInfo, { role: "assistant" }>;

function buildMessageUpdatedEvent(
  role: "user" | "assistant",
  options?: { time?: { created: number; completed?: number } }
): MessageUpdatedEvent {
  if (role === "assistant") {
    const info: AssistantMessageInfo = {
      id: "msg_test",
      sessionID: "ses_test",
      role: "assistant",
      parentID: "msg_user",
      time: {
        created: Date.now(),
        ...options?.time,
      },
      modelID: "model_test",
      providerID: "provider_test",
      mode: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
    };

    return {
      type: "message.updated",
      properties: { info },
    } satisfies MessageUpdatedEvent;
  }

  const info: UserMessageInfo = {
    id: "msg_test",
    sessionID: "ses_test",
    role: "user",
    time: {
      created: Date.now(),
      ...options?.time,
    },
  } as UserMessageInfo;

  return {
    type: "message.updated",
    properties: { info },
  } satisfies MessageUpdatedEvent;
}
