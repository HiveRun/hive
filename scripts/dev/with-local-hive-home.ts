import { spawn } from "node:child_process";
import {
  resolveDefaultDevCellsRoot,
  resolveDefaultDevHiveHome,
} from "./local-hive-home";

const [, , ...rawArgs] = process.argv;
const command = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;

if (command.length === 0) {
  process.stderr.write(
    "Usage: bun scripts/dev/with-local-hive-home.ts -- <command> [args...]\n"
  );
  process.exit(1);
}

const hiveHome =
  process.env.HIVE_HOME ?? resolveDefaultDevHiveHome(process.cwd());
const cellsRoot =
  process.env.HIVE_CELLS_ROOT ??
  (process.env.HIVE_HOME
    ? undefined
    : resolveDefaultDevCellsRoot(process.cwd(), process.env.XDG_STATE_HOME));

const child = spawn(command[0] ?? "", command.slice(1), {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...(cellsRoot ? { HIVE_CELLS_ROOT: cellsRoot } : {}),
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
