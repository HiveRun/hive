import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSg } from "./cli";
import { resetSgCliPath, resolveSgCliPath, setSgCliPath } from "./constants";

const EXECUTABLE_FILE_MODE = 0o700;

describe("ast-grep subprocess output", () => {
  afterEach(() => {
    resetSgCliPath();
  });

  it("runs searches with the pinned package binary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hive-ast-grep-package-"));
    await writeFile(join(directory, "input.ts"), "console.log('ready');\n");

    const result = await runSg({
      cwd: directory,
      pattern: "console.log($MSG)",
      lang: "typescript",
    });

    expect(result.error).toBeUndefined();
    expect(result.totalMatches).toBe(1);
  });

  it("fails explicitly when the pinned package cannot be resolved", () => {
    expect(() =>
      resolveSgCliPath(() => {
        throw new Error("package not installed");
      })
    ).toThrow(
      "Pinned @ast-grep/cli@0.40.0 binary is unavailable (package not installed); PATH and network fallbacks are disabled."
    );
  });

  it("bounds simultaneous stdout and stderr while reading", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hive-ast-grep-output-"));
    const executable = join(directory, "large-output");
    await writeFile(
      executable,
      [
        "#!/usr/bin/env bun",
        'const output = "x".repeat(2 * 1024 * 1024);',
        "process.stdout.write(output);",
        "process.stderr.write(output);",
      ].join("\n")
    );
    await chmod(executable, EXECUTABLE_FILE_MODE);
    setSgCliPath(executable);

    const result = await runSg({
      cwd: directory,
      pattern: "console.log($MSG)",
      lang: "typescript",
    });

    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe("max_output_bytes");
  });

  it("fails explicitly instead of using a PATH binary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hive-ast-grep-missing-"));
    const pathBinary = join(directory, "sg");
    const invocationMarker = join(directory, "path-sg-was-run");
    await writeFile(
      pathBinary,
      `#!/bin/sh\ntouch "${invocationMarker}"\nprintf '[]'\n`
    );
    await chmod(pathBinary, EXECUTABLE_FILE_MODE);
    setSgCliPath(join(directory, "missing-package-sg"));
    const originalPath = process.env.PATH;
    process.env.PATH = `${directory}:${originalPath ?? ""}`;

    try {
      const result = await runSg({
        cwd: directory,
        pattern: "console.log($MSG)",
        lang: "typescript",
      });

      expect(result.error).toContain(
        "Pinned @ast-grep/cli@0.40.0 binary is unavailable"
      );
      expect(result.error).toContain("PATH and network fallbacks are disabled");
      expect(existsSync(invocationMarker)).toBe(false);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
