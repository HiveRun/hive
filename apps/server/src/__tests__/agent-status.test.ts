import type { V2Event } from "@opencode-ai/client";
import { describe, expect, it } from "vitest";
import {
  resolveRuntimeModeFromEvent,
  resolveRuntimeStatusFromEvent,
} from "../agents/service";
import { createV2EventFixtures } from "./opencode-v2-test-fixtures";

const events = createV2EventFixtures("ses-test");

type StatusCase = {
  name: string;
  event: V2Event;
  expected: ReturnType<typeof resolveRuntimeStatusFromEvent>;
};

const statusCases = [
  {
    name: "ignores user agent selection updates",
    event: events.agentSelected("build"),
    expected: null,
  },
  {
    name: "returns working for assistant step updates",
    event: events.stepStarted("build"),
    expected: { status: "working" },
  },
  {
    name: "returns awaiting_input for session idle events",
    event: events.sessionIdle(),
    expected: { status: "awaiting_input" },
  },
  {
    name: "returns awaiting_input for session status idle updates",
    event: events.sessionStatus({ type: "idle" }),
    expected: { status: "awaiting_input" },
  },
  {
    name: "returns working for session status busy updates",
    event: events.sessionStatus({ type: "busy" }),
    expected: { status: "working" },
  },
  {
    name: "returns awaiting_input for permission prompts",
    event: events.permissionAsked(),
    expected: { status: "awaiting_input" },
  },
  {
    name: "returns working for permission replies",
    event: events.permissionReplied(),
    expected: { status: "working" },
  },
  {
    name: "returns awaiting_input for plan questions",
    event: events.formCreated(),
    expected: { status: "awaiting_input" },
  },
  {
    name: "returns working for answered plan questions",
    event: events.formReplied(),
    expected: { status: "working" },
  },
  {
    name: "returns awaiting_input for rejected plan questions",
    event: events.formCancelled(),
    expected: { status: "awaiting_input" },
  },
  {
    name: "returns error info for failed executions",
    event: events.executionFailed({
      type: "ProviderError",
      message: "boom",
      status: 503,
    }),
    expected: { status: "error", error: "boom" },
  },
] satisfies readonly StatusCase[];

describe("resolveRuntimeStatusFromEvent", () => {
  it.each(statusCases)("$name", ({ event, expected }) => {
    expect(resolveRuntimeStatusFromEvent(event)).toEqual(expected);
  });
});

describe("resolveRuntimeModeFromEvent", () => {
  it.each([
    {
      name: "uses session agent selections",
      event: events.agentSelected("build"),
      expected: "build",
    },
    {
      name: "uses assistant step agent updates",
      event: events.stepStarted("plan"),
      expected: "plan",
    },
  ] satisfies readonly {
    name: string;
    event: V2Event;
    expected: ReturnType<typeof resolveRuntimeModeFromEvent>;
  }[])("$name", ({ event, expected }) => {
    expect(resolveRuntimeModeFromEvent(event)).toBe(expected);
  });
});
