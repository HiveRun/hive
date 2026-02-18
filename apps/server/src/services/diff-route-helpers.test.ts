import { describe, expect, it } from "vitest";
import type { Cell } from "../schema/cells";
import { parseDiffRequest } from "./diff-route-helpers";

const baseCell: Cell = {
  id: "cell-1",
  name: "Cell 1",
  description: null,
  templateId: "template-1",
  workspacePath: "/tmp/workspaces/cell-1",
  workspaceId: "workspace-1",
  workspaceRootPath: "/tmp/workspaces",
  opencodeSessionId: null,
  resumeAgentSessionOnStartup: false,
  createdAt: new Date("2026-02-18T00:00:00.000Z"),
  status: "ready",
  lastSetupError: null,
  branchName: "cell-1",
  baseCommit: "abc123",
};

describe("parseDiffRequest", () => {
  it("returns 409 while a cell is deleting", () => {
    const result = parseDiffRequest(
      {
        ...baseCell,
        status: "deleting",
      },
      {}
    );

    expect(result).toEqual({
      ok: false,
      status: 409,
      message: "Cell workspace is not ready yet",
    });
  });
});
