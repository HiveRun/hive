/// <reference types="vitest" />

import { describe, expect, it } from "vitest";

import { COMPLETION_SHELLS, renderCompletionScript } from "./completions";

describe("renderCompletionScript", () => {
  it("includes uninstall command completions for each shell", () => {
    for (const shell of COMPLETION_SHELLS) {
      const script = renderCompletionScript(shell);
      expect(script).toContain("uninstall");
    }
  });
});
