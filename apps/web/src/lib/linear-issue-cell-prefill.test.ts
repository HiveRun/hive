import { describe, expect, it } from "vitest";
import { linearIssueToCellPrefill } from "./linear-issue-cell-prefill";

describe("linearIssueToCellPrefill", () => {
  it("includes the Linear issue URL in the cell description", () => {
    expect(
      linearIssueToCellPrefill({
        id: "issue-1",
        teamId: "team-1",
        identifier: "ENG-42",
        title: "Improve Linear integration",
        description: "Use the linked issue to scope the work.",
        url: "https://linear.app/hiverun/issue/ENG-42",
        updatedAt: "2025-01-01T00:00:00.000Z",
        completedAt: null,
        state: null,
        assignee: null,
      })
    ).toEqual({
      name: "Improve Linear integration",
      description:
        "Improve Linear integration\n\nUse the linked issue to scope the work.\n\nLinear issue: https://linear.app/hiverun/issue/ENG-42",
      sourceLabel: "ENG-42",
    });
  });

  it("omits the Linear issue URL line when Linear does not return one", () => {
    expect(
      linearIssueToCellPrefill({
        id: "issue-2",
        teamId: "team-1",
        identifier: "ENG-43",
        title: "Fix follow-up issue",
        description: null,
        url: null,
        updatedAt: "2025-01-02T00:00:00.000Z",
        completedAt: null,
        state: null,
        assignee: null,
      }).description
    ).toBe("Fix follow-up issue");
  });
});
