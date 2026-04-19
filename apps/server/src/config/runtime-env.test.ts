import { describe, expect, it } from "vitest";

import { applyRuntimeEnvFiles } from "./runtime-env";

const createFileReader = (files: Record<string, string>) => ({
  exists: (path: string) => path in files,
  readFile: (path: string) => files[path] ?? "",
});

describe("applyRuntimeEnvFiles", () => {
  it("prefers bundled install-managed values in compiled runtime", () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: "/tmp/stale.db",
      HIVE_MIGRATIONS_DIR: "/tmp/stale-migrations",
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
});
