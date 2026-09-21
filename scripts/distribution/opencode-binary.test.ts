import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { resolveOpencodeBinary } from "../../apps/server/src/agents/opencode-binary";
import { createTempDirFixture } from "../dev/test-temp-dir";
import {
  assertOpenCodeBinary,
  OPENCODE_VERSION_OUTPUT,
  openCodePackageBinaryPath,
  openCodeReleaseBinaryName,
} from "./common";

const EXECUTABLE_PERMISSIONS = 0o755;
const originalConfiguredBinary = process.env.HIVE_OPENCODE_BIN;
const createTempDirectory = createTempDirFixture("hive-opencode-binary-");

const writeExecutable = (contents: string) => {
  const binaryPath = join(createTempDirectory(), "opencode2");
  writeFileSync(binaryPath, contents);
  chmodSync(binaryPath, EXECUTABLE_PERMISSIONS);
  return binaryPath;
};

afterEach(() => {
  process.env.HIVE_OPENCODE_BIN = originalConfiguredBinary;
});

describe("resolveOpencodeBinary", () => {
  test("returns an absolute path for an exact relative override", () => {
    const binaryPath = writeExecutable(
      `#!/usr/bin/env bash\nprintf '${OPENCODE_VERSION_OUTPUT}\\n'\n`
    );
    process.env.HIVE_OPENCODE_BIN = relative(process.cwd(), binaryPath);

    expect(resolveOpencodeBinary()).toBe(binaryPath);
  });

  test("rejects an override with a different version", () => {
    const binaryPath = writeExecutable(
      "#!/usr/bin/env bash\nprintf 'opencode2 v0.0.0-beta-wrong\\n'\n"
    );
    process.env.HIVE_OPENCODE_BIN = binaryPath;

    expect(() => resolveOpencodeBinary()).toThrow("version mismatch");
  });

  test("times out a stalled override", () => {
    const binaryPath = writeExecutable("#!/usr/bin/env bash\nsleep 30\n");
    process.env.HIVE_OPENCODE_BIN = binaryPath;

    expect(() => resolveOpencodeBinary()).toThrow("Timed out after 2000ms");
  });
});

describe("assertOpenCodeBinary", () => {
  test("accepts the exact OpenCode 2 version with surrounding whitespace", async () => {
    const binaryPath = writeExecutable(
      `#!/usr/bin/env bash\nprintf '  ${OPENCODE_VERSION_OUTPUT}  \\n\\n'\n`
    );

    await expect(assertOpenCodeBinary(binaryPath)).resolves.toBeUndefined();
  });

  test("rejects a missing payload", async () => {
    const binaryPath = join(createTempDirectory(), "opencode2");

    await expect(assertOpenCodeBinary(binaryPath)).rejects.toThrow("missing");
  });

  test("rejects a non-executable payload", async () => {
    const binaryPath = join(createTempDirectory(), "opencode2");
    writeFileSync(binaryPath, OPENCODE_VERSION_OUTPUT);

    await expect(assertOpenCodeBinary(binaryPath)).rejects.toThrow(
      "not executable"
    );
  });

  test("rejects a payload for the wrong platform", async () => {
    const binaryPath = join(createTempDirectory(), "opencode2");
    writeFileSync(binaryPath, Buffer.from("MZ\\x90\\x00windows-executable"));
    chmodSync(binaryPath, EXECUTABLE_PERMISSIONS);

    await expect(assertOpenCodeBinary(binaryPath)).rejects.toThrow(
      "cannot run on this platform"
    );
  });

  test("rejects the wrong OpenCode 2 version", async () => {
    const binaryPath = writeExecutable(
      "#!/usr/bin/env bash\nprintf 'opencode2 v0.0.0-beta-wrong\\n'\n"
    );

    await expect(assertOpenCodeBinary(binaryPath)).rejects.toThrow(
      "version mismatch"
    );
  });
});

describe("OpenCode package binary", () => {
  test("uses the official package-selected binary", () => {
    expect(
      openCodePackageBinaryPath("/packages/cli", {
        opencode2: "./bin/opencode2.exe",
      })
    ).toBe(join(resolve("/packages/cli"), "bin", "opencode2.exe"));
  });

  test("preserves platform release executable names", () => {
    expect(openCodeReleaseBinaryName("linux")).toBe("opencode2");
    expect(openCodeReleaseBinaryName("darwin")).toBe("opencode2");
    expect(openCodeReleaseBinaryName("win32")).toBe("opencode2.exe");
  });

  test("rejects a package without the official command", () => {
    expect(() => openCodePackageBinaryPath("/packages/cli", {})).toThrow(
      "does not declare opencode2"
    );
  });
});
