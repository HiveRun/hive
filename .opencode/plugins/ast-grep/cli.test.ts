import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSg } from "./cli";
import { setSgCliPath } from "./constants";

const EXECUTABLE_FILE_MODE = 0o700;

describe("ast-grep subprocess output", () => {
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
});
