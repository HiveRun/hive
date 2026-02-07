import { describe, expect, it } from "vitest";
import { formatStatus, getStatusAppearance } from "./status-theme";

describe("status-theme", () => {
  it("returns default appearance for unknown status", () => {
    const appearance = getStatusAppearance("unknown_status");
    expect(appearance.badge).toContain("border-border");
  });

  it("formats status labels for display", () => {
    expect(formatStatus("awaiting_input")).toBe("AWAITING INPUT");
  });
});
