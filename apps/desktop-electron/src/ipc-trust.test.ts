import { describe, expect, it } from "vitest";
import { isTrustedIpcSender } from "./ipc-trust";

describe("IPC sender trust", () => {
  const activeContents = { id: 1 };

  it("accepts only the active trusted main contents", () => {
    expect(
      isTrustedIpcSender({
        activeContents,
        isTrusted: () => true,
        sender: activeContents,
      })
    ).toBe(true);
  });

  it("rejects stale, arbitrary, and untrusted contents", () => {
    expect(
      isTrustedIpcSender({
        activeContents,
        isTrusted: () => true,
        sender: { id: 1 },
      })
    ).toBe(false);
    expect(
      isTrustedIpcSender({
        activeContents,
        isTrusted: () => false,
        sender: activeContents,
      })
    ).toBe(false);
    expect(
      isTrustedIpcSender({
        activeContents: null,
        isTrusted: () => true,
        sender: activeContents,
      })
    ).toBe(false);
  });
});
