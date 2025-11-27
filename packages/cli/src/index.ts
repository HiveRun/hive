import { COMPLETION_SHELLS, renderCompletionScript } from "./completions";

const rawArgv = process.argv.slice(2);

if (process.env.SYNTHETIC_DEBUG_ARGS === "1") {
  process.stderr.write(`[synthetic argv] ${JSON.stringify(rawArgv)}\n`);
}

if (rawArgv[0] === "completions") {
  const shell = rawArgv[1];
  const script = shell ? renderCompletionScript(shell) : null;

  if (!script) {
    process.stderr.write(
      `Unsupported shell "${shell ?? ""}". Supported shells: ${COMPLETION_SHELLS.join(", ")}`
    );
    process.exit(1);
  }

  process.stdout.write(script.endsWith("\n") ? script : `${script}\n`);
  process.exit(0);
}

process.env.DOTENV_CONFIG_SILENT ??= "true";

await import("./cli");
