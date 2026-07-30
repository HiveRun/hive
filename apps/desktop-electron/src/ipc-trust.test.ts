import { describe, expect, it } from "vitest";
import { isTrustedIpcSender } from "./ipc-trust";

describe("IPC sender trust", () => {
  const activeContents = { id: 1 };
  const trusted = () => true;

  it("accepts only the active trusted main contents", () => {
    expect(isTrustedIpcSender(activeContents, activeContents, trusted)).toBe(
      true
    );
  });

  it("rejects stale, arbitrary, and untrusted contents", () => {
    expect(isTrustedIpcSender(activeContents, { id: 1 }, trusted)).toBe(false);
    expect(
      isTrustedIpcSender(activeContents, activeContents, () => false)
    ).toBe(false);
    expect(isTrustedIpcSender(null, activeContents, trusted)).toBe(false);
  });
});
