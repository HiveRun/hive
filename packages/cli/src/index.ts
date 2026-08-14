#!/usr/bin/env bun

export {};

process.env.DOTENV_CONFIG_SILENT ??= "true";

const rawArgv = process.argv.slice(2);
if (rawArgv[0] === "android") {
  const { dispatchAndroidCommand } = await import("@hive/android-runtime");
  const exitCode = await dispatchAndroidCommand(rawArgv);
  process.exit(exitCode ?? 1);
}

await import("./cli");
