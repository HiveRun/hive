import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const [, , ...rawArgs] = process.argv;
const command = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

if (command.length === 0) {
  process.stderr.write(
    "Usage: bun scripts/dev/with-local-hive-home.ts -- <command> [args...]\n"
  );
  process.exit(1);
}

const workspaceRoot = resolveWorkspaceRoot(process.cwd());
const hiveHome = process.env.HIVE_HOME ?? join(workspaceRoot, ".hive", "home");

const child = spawn(command[0] ?? "", command.slice(1), {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HIVE_HOME: hiveHome,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  process.stderr.write(`Failed to start command: ${error.message}\n`);
  process.exit(1);
});

function resolveWorkspaceRoot(currentDir: string) {
  const normalizedRoot = resolveBaseWorkspaceRoot(currentDir);

  if (hasHiveConfig(normalizedRoot)) {
    return normalizedRoot;
  }

  const nestedCandidate = resolve(normalizedRoot, "hive");
  if (hasHiveConfig(nestedCandidate)) {
    return nestedCandidate;
  }

  return normalizedRoot;
}

function resolveBaseWorkspaceRoot(currentDir: string) {
  const normalizedCurrentDir = resolve(currentDir);
  const appsSegment = `${sep}apps${sep}`;

  if (normalizedCurrentDir.includes(appsSegment)) {
    const [root] = normalizedCurrentDir.split(appsSegment);
    return root || normalizedCurrentDir;
  }

  return normalizedCurrentDir;
}

function hasHiveConfig(directory: string) {
  return existsSync(join(directory, "hive.config.json"));
}
