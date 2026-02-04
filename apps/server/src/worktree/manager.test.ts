import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHiveServerUrl } from "./manager";

describe("resolveHiveServerUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HIVE_URL = undefined;
    process.env.PORT = undefined;
    process.env.HOST = undefined;
    process.env.HOSTNAME = undefined;
    process.env.HIVE_PROTOCOL = undefined;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns http://localhost:3000 by default", () => {
    expect(resolveHiveServerUrl()).toBe("http://localhost:3000");
  });

  it("uses localhost not 127.0.0.1 for IPv4/IPv6 compatibility", () => {
    // Server may bind IPv6 only; localhost resolves correctly for either
    const url = resolveHiveServerUrl();
    expect(url).not.toContain("127.0.0.1");
    expect(url).toContain("localhost");
  });

  it("uses HIVE_URL when set", () => {
    process.env.HIVE_URL = "https://custom.example.com:8080";
    expect(resolveHiveServerUrl()).toBe("https://custom.example.com:8080");
  });

  it("respects PORT env var", () => {
    process.env.PORT = "4000";
    expect(resolveHiveServerUrl()).toBe("http://localhost:4000");
  });
});
