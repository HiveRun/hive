import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { resolveOpencodeBinary } from "../../apps/server/src/agents/opencode-binary";
import {
  assertOpenCodeBinary,
  OPENCODE_VERSION_OUTPUT,
  openCodeNativePackageName,
} from "./common";

const EXECUTABLE_PERMISSIONS = 0o755;
const tempDirectories: string[] = [];
const originalConfiguredBinary = process.env.HIVE_OPENCODE_BIN;

const createTempDirectory = () => {
  const directory = mkdtempSync(join(tmpdir(), "hive-opencode-binary-"));
  tempDirectories.push(directory);
  return directory;
};

const writeExecutable = (contents: string) => {
  const binaryPath = join(createTempDirectory(), "opencode2");
  writeFileSync(binaryPath, contents);
  chmodSync(binaryPath, EXECUTABLE_PERMISSIONS);
  return binaryPath;
};

afterEach(() => {
  process.env.HIVE_OPENCODE_BIN = originalConfiguredBinary;
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
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

describe("openCodeNativePackageName", () => {
  test("uses baseline builds for x64 release targets", () => {
    expect(openCodeNativePackageName("linux", "x64")).toBe(
      "@opencode-ai/cli-linux-x64-baseline"
    );
    expect(openCodeNativePackageName("darwin", "x64")).toBe(
      "@opencode-ai/cli-darwin-x64-baseline"
    );
    expect(openCodeNativePackageName("win32", "x64")).toBe(
      "@opencode-ai/cli-windows-x64-baseline"
    );
  });

  test("uses native arm64 release targets", () => {
    expect(openCodeNativePackageName("linux", "arm64")).toBe(
      "@opencode-ai/cli-linux-arm64"
    );
    expect(openCodeNativePackageName("win32", "arm64")).toBe(
      "@opencode-ai/cli-windows-arm64"
    );
  });
});
