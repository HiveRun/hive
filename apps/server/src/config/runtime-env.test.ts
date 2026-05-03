import { describe, expect, it } from "vitest";

import { applyRuntimeEnvFiles } from "./runtime-env";

const createFileReader = (files: Record<string, string>) => ({
  exists: (path: string) => path in files,
  readFile: (path: string) => files[path] ?? "",
});

const serializeEnvFile = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");

const releaseEnvFile = (values: Record<string, string> = {}) =>
  serializeEnvFile({
    DATABASE_URL: "/release/hive.db",
    HIVE_MIGRATIONS_DIR: "/release/migrations",
    HIVE_WEB_DIST: "/release/public",
    PORT: "3000",
    ...values,
  });

const applyTestEnv = (
  env: Record<string, string | undefined>,
  files: Record<string, string>,
  isCompiledRuntime: boolean
) => {
  const { exists, readFile } = createFileReader(files);

  applyRuntimeEnvFiles({
    env,
    candidateEnvFiles: Object.keys(files),
    isCompiledRuntime,
    exists,
    readFile,
  });
};

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

    applyTestEnv(
      env,
      {
        "/release/hive.env": releaseEnvFile(),
        "/workspace/.env": serializeEnvFile({
          DATABASE_URL: "/workspace/dev.db",
          HIVE_MIGRATIONS_DIR: "/workspace/migrations",
        }),
      },
      true
    );

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

    applyTestEnv(
      env,
      {
        "/release/hive.env": releaseEnvFile({
          HIVE_OPENCODE_BIN: "/release/opencode",
        }),
      },
      true
    );

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

    applyTestEnv(env, { "/release/hive.env": releaseEnvFile() }, false);

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

        return serializeEnvFile({
          DATABASE_URL: "/release/hive.db",
          HIVE_MIGRATIONS_DIR: "/release/migrations",
        });
      },
    });

    expect(env.DATABASE_URL).toBe("/release/hive.db");
    expect(env.HIVE_MIGRATIONS_DIR).toBe("/release/migrations");
  });
});
