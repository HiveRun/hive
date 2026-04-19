import { describe, expect, it } from "vitest";

import { applyRuntimeEnvFiles } from "./runtime-env";

const createFileReader = (files: Record<string, string>) => ({
  exists: (path: string) => path in files,
  readFile: (path: string) => files[path] ?? "",
});

describe("applyRuntimeEnvFiles", () => {
  it("replaces stale hive-managed paths in compiled runtime", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: "/home/aureatus/.hive/state/hive.db",
      HIVE_MIGRATIONS_DIR:
        "/home/aureatus/.hive/releases/hive-linux-x64.old/migrations",
      HIVE_WEB_DIST: "/home/aureatus/.hive/releases/hive-linux-x64.old/public",
      HIVE_OPENCODE_BIN: "/custom/opencode",
      PORT: "9999",
    };

    const files = {
      "/release/hive.env": [
        'DATABASE_URL="/release/hive.db"',
        'HIVE_MIGRATIONS_DIR="/release/migrations"',
        'HIVE_WEB_DIST="/release/public"',
        'PORT="3000"',
      ].join("\n"),
      "/workspace/.env": [
        'DATABASE_URL="/workspace/dev.db"',
        'HIVE_MIGRATIONS_DIR="/workspace/migrations"',
      ].join("\n"),
    };

    const { exists, readFile } = createFileReader(files);

    applyRuntimeEnvFiles({
      env,
      candidateEnvFiles: ["/release/hive.env", "/workspace/.env"],
      isCompiledRuntime: true,
      exists,
      readFile,
    });

    expect(env.DATABASE_URL).toBe("/release/hive.db");
    expect(env.HIVE_MIGRATIONS_DIR).toBe("/release/migrations");
    expect(env.HIVE_WEB_DIST).toBe("/release/public");
    expect(env.HIVE_OPENCODE_BIN).toBe("/custom/opencode");
    expect(env.PORT).toBe("9999");
  });

  it("preserves explicit overrides in compiled runtime", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: "/tmp/test.db",
      HIVE_MIGRATIONS_DIR: "/tmp/custom-migrations",
      HIVE_WEB_DIST: "/tmp/public",
      HIVE_OPENCODE_BIN: "/tmp/opencode",
      PORT: "9999",
    };

    const files = {
      "/release/hive.env": [
        'DATABASE_URL="/release/hive.db"',
        'HIVE_MIGRATIONS_DIR="/release/migrations"',
        'HIVE_WEB_DIST="/release/public"',
        'HIVE_OPENCODE_BIN="/release/opencode"',
        'PORT="3000"',
      ].join("\n"),
    };

    const { exists, readFile } = createFileReader(files);

    applyRuntimeEnvFiles({
      env,
      candidateEnvFiles: ["/release/hive.env"],
      isCompiledRuntime: true,
      exists,
      readFile,
    });

    expect(env.DATABASE_URL).toBe("/tmp/test.db");
    expect(env.HIVE_MIGRATIONS_DIR).toBe("/tmp/custom-migrations");
    expect(env.HIVE_WEB_DIST).toBe("/tmp/public");
    expect(env.HIVE_OPENCODE_BIN).toBe("/tmp/opencode");
    expect(env.PORT).toBe("9999");
  });

  it("keeps inherited values outside compiled runtime", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: "/tmp/dev.db",
      HIVE_MIGRATIONS_DIR: "/tmp/dev-migrations",
      PORT: "9999",
    };

    const files = {
      "/release/hive.env": [
        'DATABASE_URL="/release/hive.db"',
        'HIVE_MIGRATIONS_DIR="/release/migrations"',
        'HIVE_WEB_DIST="/release/public"',
        'PORT="3000"',
      ].join("\n"),
    };

    const { exists, readFile } = createFileReader(files);

    applyRuntimeEnvFiles({
      env,
      candidateEnvFiles: ["/release/hive.env"],
      isCompiledRuntime: false,
      exists,
      readFile,
    });

    expect(env.DATABASE_URL).toBe("/tmp/dev.db");
    expect(env.HIVE_MIGRATIONS_DIR).toBe("/tmp/dev-migrations");
    expect(env.HIVE_WEB_DIST).toBe("/release/public");
    expect(env.PORT).toBe("9999");
  });

  it("skips unreadable env files and continues to later candidates", () => {
    const env: Record<string, string | undefined> = {};

    applyRuntimeEnvFiles({
      env,
      candidateEnvFiles: ["/broken/hive.env", "/release/hive.env"],
      isCompiledRuntime: true,
      exists: () => true,
      readFile: (path) => {
        if (path === "/broken/hive.env") {
          throw new Error("EACCES");
        }

        return [
          'DATABASE_URL="/release/hive.db"',
          'HIVE_MIGRATIONS_DIR="/release/migrations"',
        ].join("\n");
      },
    });

    expect(env.DATABASE_URL).toBe("/release/hive.db");
    expect(env.HIVE_MIGRATIONS_DIR).toBe("/release/migrations");
  });
});
