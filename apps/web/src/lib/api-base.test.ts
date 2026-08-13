import { afterEach, describe, expect, it, vi } from "vitest";
import { getApiBase } from "./api-base";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getApiBase", () => {
  it("uses the browser origin for same-origin release builds", () => {
    vi.stubEnv("VITE_API_URL", "same-origin");

    expect(getApiBase()).toBe(window.location.origin);
  });

  it("preserves an explicitly configured API URL", () => {
    vi.stubEnv("VITE_API_URL", "http://127.0.0.1:43123");

    expect(getApiBase()).toBe("http://127.0.0.1:43123");
  });
});
