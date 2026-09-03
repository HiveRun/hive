import type { OpenCodeEvent } from "@opencode-ai/client";
import { describe, expect, it } from "vitest";
import {
  adaptOpencodeEvent,
  resolveRuntimeModeFromEvent,
  resolveRuntimeStatusFromEvent,
} from "../agents/service";
import type { AgentRuntimeEvent } from "../agents/types";

describe("resolveRuntimeStatusFromEvent", () => {
  it("returns null when user agent selection updates", () => {
    expect(resolveStatus(buildAgentSelectedEvent("build"))).toBeNull();
  });

  it("returns working for assistant step updates", () => {
    expect(resolveStatus(buildStepStartedEvent("build"))).toEqual({
      status: "working",
    });
  });

  it("returns awaiting_input for session idle events", () => {
    assertResolvedStatus(v2Event("session.idle"), "awaiting_input");
  });

  it("returns awaiting_input for session status idle updates", () => {
    assertResolvedStatus(
      v2Event("session.status", { status: { type: "idle" } }),
      "awaiting_input"
    );
  });

  it("returns working for session status busy updates", () => {
    assertResolvedStatus(
      v2Event("session.status", { status: { type: "busy" } }),
      "working"
    );
  });

  it("returns awaiting_input for permission prompts", () => {
    assertResolvedStatus(buildPermissionAskedEvent(), "awaiting_input");
  });

  it("returns working for permission replies", () => {
    assertResolvedStatus(buildPermissionRepliedEvent(), "working");
  });

  it("returns awaiting_input for plan questions", () => {
    assertResolvedStatus(buildFormCreatedEvent(), "awaiting_input");
  });

  it("returns working for answered plan questions", () => {
    assertResolvedStatus(buildFormRepliedEvent(), "working");
  });

  it("returns awaiting_input for rejected plan questions", () => {
    assertResolvedStatus(buildFormCancelledEvent(), "awaiting_input");
  });

  it("returns error info for failed executions", () => {
    expect(resolveStatus(buildExecutionFailedEvent())).toEqual({
      status: "error",
      error: "boom",
    });
  });
});

describe("resolveRuntimeModeFromEvent", () => {
  it("uses session agent selections", () => {
    expect(resolveMode(buildAgentSelectedEvent("build"))).toBe("build");
  });

  it("uses assistant step agent updates", () => {
    expect(resolveMode(buildStepStartedEvent("plan"))).toBe("plan");
  });
});

function adapt(event: OpenCodeEvent): AgentRuntimeEvent {
  const adapted = adaptOpencodeEvent(event);
  if (!adapted) {
    throw new Error(`Expected ${event.type} to be adapted`);
  }
  return adapted;
}

function resolveStatus(event: OpenCodeEvent) {
  return resolveRuntimeStatusFromEvent(adapt(event));
}

function resolveMode(event: OpenCodeEvent) {
  return resolveRuntimeModeFromEvent(adapt(event));
}

function eventBase() {
  return { id: "evt_test", created: Date.now() };
}

function durable() {
  return { aggregateID: "ses_test", seq: 1, version: 1 as const };
}

function v2Event(
  type: "session.idle" | "session.status",
  data: Record<string, unknown> = {}
): OpenCodeEvent {
  if (type === "session.status") {
    return {
      ...eventBase(),
      type,
      data: {
        sessionID: "ses_test",
        status: data.status as { type: "idle" | "busy" },
      },
    };
  }
  return { ...eventBase(), type, data: { sessionID: "ses_test" } };
}

function buildAgentSelectedEvent(agent: "plan" | "build"): OpenCodeEvent {
  return {
    ...eventBase(),
    type: "session.agent.selected",
    durable: durable(),
    data: { sessionID: "ses_test", agent },
  };
}

function buildStepStartedEvent(agent: "plan" | "build"): OpenCodeEvent {
  return {
    ...eventBase(),
    type: "session.step.started",
    durable: durable(),
    data: {
      sessionID: "ses_test",
      assistantMessageID: "msg_test",
      agent,
      model: { id: "model_test", providerID: "provider_test" },
    },
  };
}

function buildPermissionAskedEvent(): OpenCodeEvent {
  return {
    ...eventBase(),
    type: "permission.asked",
    data: {
      id: "perm_test",
      sessionID: "ses_test",
      action: "plan_exit",
      resources: ["plan_exit"],
    },
  };
}

function buildPermissionRepliedEvent(): OpenCodeEvent {
  return {
    ...eventBase(),
    type: "permission.replied",
    data: {
      sessionID: "ses_test",
      requestID: "perm_test",
      reply: "once",
    },
  };
}

function buildFormCreatedEvent(): OpenCodeEvent {
  return {
    ...eventBase(),
    type: "form.created",
    data: {
      form: {
        id: "question_test",
        sessionID: "ses_test",
        title: "Continue?",
        fields: [{ key: "continue", type: "boolean" }],
      },
    },
  };
}

function buildFormRepliedEvent(): OpenCodeEvent {
  return {
    ...eventBase(),
    type: "form.replied",
    data: {
      id: "question_test",
      sessionID: "ses_test",
      answer: { continue: true },
    },
  };
}

function buildFormCancelledEvent(): OpenCodeEvent {
  return {
    ...eventBase(),
    type: "form.cancelled",
    data: { id: "question_test", sessionID: "ses_test" },
  };
}

function buildExecutionFailedEvent(): OpenCodeEvent {
  return {
    ...eventBase(),
    type: "session.execution.failed",
    durable: durable(),
    data: {
      sessionID: "ses_test",
      error: { type: "ProviderError", message: "boom" },
    },
  };
}

function assertResolvedStatus(
  sourceEvent: OpenCodeEvent,
  status: "awaiting_input" | "working"
) {
  const actual = resolveStatus(sourceEvent);
  if (actual?.status !== status || actual.error) {
    throw new Error(`Expected status ${status}, got ${JSON.stringify(actual)}`);
  }
}
