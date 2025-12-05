import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentMessagePart } from "@/queries/agents";

import { MessageBubble, type TracePreferences } from "./message-bubble";

afterEach(() => {
  cleanup();
});

type PartInput = Partial<AgentMessagePart> & Pick<AgentMessagePart, "type">;

const TRACE_ALL_VISIBLE: TracePreferences = {
  showReasoning: true,
  showToolRuns: true,
  showDiffs: true,
};

const MESSAGE_CREATED_AT = new Date("2025-01-01T00:00:00.000Z");
const TOOL_CARD_LABEL_REGEX = /Tool · Format code/i;
const TOOL_CARD_PATH_REGEX = /src\/example\.ts/i;
const EXPAND_BUTTON_REGEX = /expand/i;
const TOOL_TIME_RANGE = { start: 1000, end: 2000 } as const;

let messageCounter = 0;

function createMessage(parts: PartInput[]) {
  messageCounter += 1;
  const messageId = `msg_test_${messageCounter}`;
  const sessionId = `ses_test_${messageCounter}`;

  return {
    id: messageId,
    sessionId,
    role: "assistant",
    content: "",
    state: "completed",
    createdAt: MESSAGE_CREATED_AT.toISOString(),
    parts: parts.map((part, index) => ({
      id: part.id ?? `part_${messageCounter}_${index}`,
      sessionID: sessionId,
      messageID: messageId,
      ...part,
    })),
  };
}

describe("MessageBubble traces", () => {
  it("renders reasoning trace content", () => {
    const message = createMessage([
      {
        type: "reasoning",
        text: "Evaluate project requirements and outline a plan.",
      },
    ]);

    render(
      <MessageBubble message={message} tracePreferences={TRACE_ALL_VISIBLE} />
    );

    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(
      screen.getByText("Evaluate project requirements and outline a plan.")
    ).toBeInTheDocument();
  });

  it("renders tool trace with diff summary", () => {
    const diffText = [
      "+++ b/src/example.ts",
      "@@ -1,2 +1,2 @@",
      '-const message = "hi";',
      '+const message = "hello";',
      "+console.log(message);",
    ].join("\n");

    const message = createMessage([
      {
        type: "tool",
        tool: "format_code",
        metadata: { diff: diffText },
        state: {
          status: "completed",
          input: { filePath: "src/example.ts" },
          output: "Formatting applied",
          metadata: { diff: diffText },
          time: { start: TOOL_TIME_RANGE.start, end: TOOL_TIME_RANGE.end },
        },
      },
    ]);

    render(
      <MessageBubble message={message} tracePreferences={TRACE_ALL_VISIBLE} />
    );

    expect(screen.getByText(TOOL_CARD_LABEL_REGEX)).toBeInTheDocument();
    expect(screen.getByText(TOOL_CARD_PATH_REGEX)).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("renders diff trace for patch parts and shows diff text when expanded", () => {
    const diffText = [
      "+++ b/src/app.ts",
      "@@ -1 +1,2 @@",
      "+const answer = 42;",
      "-const answer = null;",
    ].join("\n");

    const message = createMessage([
      {
        type: "patch",
        files: ["src/app.ts"],
        metadata: { diff: diffText },
      },
    ]);

    render(
      <MessageBubble message={message} tracePreferences={TRACE_ALL_VISIBLE} />
    );

    expect(screen.getByText("Diff")).toBeInTheDocument();

    const expandButtons = screen.getAllByRole("button", {
      name: EXPAND_BUTTON_REGEX,
    });
    const diffExpandButton = expandButtons.at(-1);
    if (!diffExpandButton) {
      throw new Error("Diff trace expand button not found");
    }
    fireEvent.click(diffExpandButton);

    expect(
      screen.getByText((content) => content.includes("+const answer = 42;"))
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => content.includes("-const answer = null;"))
    ).toBeInTheDocument();
  });
});
