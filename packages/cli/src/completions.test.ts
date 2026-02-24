/// <reference types="vitest" />

import { describe, expect, it } from "vitest";

import {
  buildCompletionCommandModel,
  COMPLETION_SHELLS,
  renderCompletionScript,
} from "./completions";

describe("renderCompletionScript", () => {
  it("uses discovered command paths for each shell", () => {
    const commandModel = buildCompletionCommandModel([
      [],
      ["stop"],
      ["uninstall"],
      ["future-command"],
      ["completions"],
      ["completions", "install"],
    ]);

    for (const shell of COMPLETION_SHELLS) {
      const script = renderCompletionScript(shell, commandModel);
      expect(script).toContain("uninstall");
      expect(script).toContain("future-command");
    }
  });
});
