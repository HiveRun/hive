import { describe, expect, it } from "vitest";
import type { AgentMessagePart } from "@/queries/agents";
import {
  computeContentFromParts,
  mergePartWithDelta,
  upsertPartWithDelta,
} from "./agent-message-utils";

const basePart: AgentMessagePart = {
  id: "part-1",
  messageID: "message-1",
  sessionID: "session-1",
  type: "text",
  text: "",
};

describe("agent-message-utils", () => {
  it("appends streaming deltas to existing part text", () => {
    const initial = mergePartWithDelta({
      ...basePart,
      text: "Hello",
    });

    const appended = mergePartWithDelta(basePart, initial, " forest");
    expect(appended.text).toBe("Hello forest");
  });

  it("upserts parts immutably while preserving accumulated text", () => {
    const firstInsert = upsertPartWithDelta([], { ...basePart, text: "Hi" });
    expect(firstInsert).toHaveLength(1);
    expect(firstInsert[0]?.text).toBe("Hi");

    const withDelta = upsertPartWithDelta(firstInsert, basePart, " there");
    expect(withDelta).toHaveLength(1);
    expect(withDelta[0]?.text).toBe("Hi there");
    // original array remains untouched
    expect(firstInsert[0]?.text).toBe("Hi");
  });

  it("returns null content when parts contain no text", () => {
    const content = computeContentFromParts([]);
    expect(content).toBeNull();

    const parts: AgentMessagePart[] = [{ ...basePart, id: "part-2", text: "" }];
    expect(computeContentFromParts(parts)).toBeNull();
  });
});
