import { repoRoot } from "./release-version";

export const runMain = async (main: () => Promise<void>) => {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
};

export const runGit = (cmd: string[], options?: { capture?: boolean }) => {
  const result = Bun.spawnSync({
    cmd,
    cwd: repoRoot,
    stdout: options?.capture ? "pipe" : "inherit",
    stderr: options?.capture ? "pipe" : "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed (${cmd.join(" ")}) with code ${result.exitCode}`
    );
  }

  if (options?.capture) {
    return new TextDecoder().decode(result.stdout).trim();
  }
};
