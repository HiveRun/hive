/// <reference types="vitest" />

import { describe, expect, it, vi } from "vitest";

import {
  resolveUninstallConfirmation,
  resolveUninstallDataRetention,
} from "./uninstall-confirmation";

describe("resolveUninstallConfirmation", () => {
  it("returns true when --yes is provided", async () => {
    const askConfirmation = vi.fn(async () => "n");

    const result = await resolveUninstallConfirmation({
      confirmedByFlag: true,
      isInteractive: true,
      askConfirmation,
    });

    expect(result).toBe(true);
    expect(askConfirmation).not.toHaveBeenCalled();
  });

  it("returns false in non-interactive sessions without --yes", async () => {
    const askConfirmation = vi.fn(async () => "y");

    const result = await resolveUninstallConfirmation({
      confirmedByFlag: false,
      isInteractive: false,
      askConfirmation,
    });

    expect(result).toBe(false);
    expect(askConfirmation).not.toHaveBeenCalled();
  });

  it("accepts interactive yes answers", async () => {
    const askConfirmation = vi.fn(async () => "Yes");

    const result = await resolveUninstallConfirmation({
      confirmedByFlag: false,
      isInteractive: true,
      askConfirmation,
    });

    expect(result).toBe(true);
  });

  it("rejects interactive non-yes answers", async () => {
    const askConfirmation = vi.fn(async () => "");

    const result = await resolveUninstallConfirmation({
      confirmedByFlag: false,
      isInteractive: true,
      askConfirmation,
    });

    expect(result).toBe(false);
  });
});

describe("resolveUninstallDataRetention", () => {
  const resolveDataRetention = (
    askConfirmation: () => Promise<string>,
    overrides: Partial<Parameters<typeof resolveUninstallDataRetention>[0]> = {}
  ) =>
    resolveUninstallDataRetention({
      keepDataByFlag: false,
      shouldPrompt: false,
      askConfirmation,
      ...overrides,
    });

  it("returns true when --keep-data is provided", async () => {
    const askConfirmation = vi.fn(async () => "n");

    const result = await resolveDataRetention(askConfirmation, {
      keepDataByFlag: true,
    });

    expect(result).toBe(true);
    expect(askConfirmation).not.toHaveBeenCalled();
  });

  it("returns false without prompt when no flag is provided", async () => {
    const askConfirmation = vi.fn(async () => "y");

    const result = await resolveDataRetention(askConfirmation);

    expect(result).toBe(false);
    expect(askConfirmation).not.toHaveBeenCalled();
  });

  it("accepts interactive keep-data confirmation", async () => {
    const askConfirmation = vi.fn(async () => "y");

    const result = await resolveDataRetention(askConfirmation, {
      shouldPrompt: true,
    });

    expect(result).toBe(true);
  });
});
