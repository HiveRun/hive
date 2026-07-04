import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activateInstanceProfile,
  addInstanceProfile,
  getInstanceRegistry,
  isLocalInstanceProfile,
  removeInstanceProfile,
  resolveInstanceProfile,
} from "./instance-config";

const LOCAL_API_URL = "http://localhost:3000";
const LOCAL_WEB_URL = "http://localhost:3000";
const NOW = new Date("2026-01-02T03:04:05.000Z");
const TEMP_ROOT = process.env.TMPDIR ?? "/tmp";

describe("instance config", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(TEMP_ROOT, "hive-cli-instances-"));
    configPath = join(tempDir, "instances.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const storeOptions = () => ({
    configPath,
    localApiUrl: LOCAL_API_URL,
    localWebUrl: LOCAL_WEB_URL,
    now: () => NOW,
  });

  it("includes a built-in local instance when no config exists", () => {
    const registry = getInstanceRegistry(storeOptions());
    const localProfile = registry.profiles[0];

    expect(registry.activeName).toBe("local");
    expect(registry.profiles).toHaveLength(1);
    if (!localProfile) {
      throw new Error("Expected local profile");
    }
    expect(isLocalInstanceProfile(localProfile)).toBe(true);
    expect(localProfile?.apiUrl).toBe(LOCAL_API_URL);
  });

  it("adds a remote instance without storing token values", () => {
    const profile = addInstanceProfile(storeOptions(), {
      name: "company",
      apiUrl: "https://hive.example.com/",
      tokenEnv: "HIVE_COMPANY_TOKEN",
      setActive: true,
    });

    const registry = getInstanceRegistry(storeOptions());
    const rawConfig = readFileSync(configPath, "utf8");

    expect(profile.apiUrl).toBe("https://hive.example.com");
    expect(profile.webUrl).toBe("https://hive.example.com");
    expect(profile.tokenEnv).toBe("HIVE_COMPANY_TOKEN");
    expect(registry.activeName).toBe("company");
    expect(registry.profiles.map((entry) => entry.name)).toEqual([
      "local",
      "company",
    ]);
    expect(rawConfig).not.toContain("secret");
  });

  it("activates and removes configured instances", () => {
    addInstanceProfile(storeOptions(), {
      name: "company",
      apiUrl: "https://hive.example.com",
    });

    const active = activateInstanceProfile(storeOptions(), "company");
    expect(active.name).toBe("company");
    expect(resolveInstanceProfile(storeOptions()).profile.name).toBe("company");

    expect(removeInstanceProfile(storeOptions(), "company")).toBe(true);
    expect(resolveInstanceProfile(storeOptions()).profile.name).toBe("local");
  });

  it("rejects invalid names and urls", () => {
    expect(() =>
      addInstanceProfile(storeOptions(), {
        name: "bad name",
        apiUrl: "https://hive.example.com",
      })
    ).toThrow("Instance name");

    expect(() =>
      addInstanceProfile(storeOptions(), {
        name: "company",
        apiUrl: "file:///tmp/hive",
      })
    ).toThrow("http or https");

    expect(() => removeInstanceProfile(storeOptions(), "local")).toThrow(
      "cannot be removed"
    );
  });
});
