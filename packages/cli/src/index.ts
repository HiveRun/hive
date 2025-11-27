import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { COMPLETION_SHELLS, renderCompletionScript } from "./completions";

type CompletionShell = (typeof COMPLETION_SHELLS)[number];

const rawArgv = process.argv.slice(2);

if (process.env.SYNTHETIC_DEBUG_ARGS === "1") {
  process.stderr.write(`[synthetic argv] ${JSON.stringify(rawArgv)}\n`);
}

const normalizeShell = (shell?: string): CompletionShell | null => {
  if (!shell) {
    return null;
  }
  const normalized = shell.toLowerCase() as CompletionShell;
  return COMPLETION_SHELLS.includes(normalized) ? normalized : null;
};

const ensureTrailingNewline = (script: string) =>
  script.endsWith("\n") ? script : `${script}\n`;

const getDefaultInstallPath = (shell: CompletionShell) => {
  const home = os.homedir();
  if (shell === "bash") {
    return join(
      home,
      ".local",
      "share",
      "bash-completion",
      "completions",
      "synthetic"
    );
  }
  if (shell === "fish") {
    return join(home, ".config", "fish", "completions", "synthetic.fish");
  }
  const zshCustom = process.env.ZSH_CUSTOM;
  if (zshCustom) {
    return join(zshCustom, "completions", "_synthetic");
  }
  const ohMyZshPath = join(
    home,
    ".oh-my-zsh",
    "custom",
    "completions",
    "_synthetic"
  );
  if (existsSync(join(home, ".oh-my-zsh"))) {
    return ohMyZshPath;
  }
  return join(home, ".config", "zsh", "completions", "_synthetic");
};

const installCompletions = (shell: CompletionShell, targetPath?: string) => {
  const script = renderCompletionScript(shell);
  if (!script) {
    return { ok: false, message: `Unsupported shell "${shell}".` } as const;
  }

  const resolvedPath = targetPath
    ? resolve(targetPath)
    : getDefaultInstallPath(shell);
  try {
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, ensureTrailingNewline(script), "utf8");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown error while writing completion script";
    return { ok: false, message } as const;
  }

  return { ok: true, path: resolvedPath } as const;
};

if (rawArgv[0] === "completions") {
  if (rawArgv[1] === "install") {
    const shell = normalizeShell(rawArgv[2]);
    if (!shell) {
      process.stderr.write(
        `Usage: synthetic completions install <shell> [destination]\nSupported shells: ${COMPLETION_SHELLS.join(
          ", "
        )}\n`
      );
      process.exit(1);
    }

    const result = installCompletions(shell, rawArgv[3]);
    if (!result.ok) {
      process.stderr.write(
        `Failed to install completions: ${result.message}\n`
      );
      process.exit(1);
    }

    process.stdout.write(
      `Installed synthetic completions for ${shell} at ${result.path}. Restart your shell to load them.\n`
    );
    process.exit(0);
  }

  const shell = normalizeShell(rawArgv[1]);
  if (!shell) {
    process.stderr.write(
      `Usage: synthetic completions <shell>\nSupported shells: ${COMPLETION_SHELLS.join(", ")}\n`
    );
    process.exit(1);
  }

  const script = renderCompletionScript(shell);
  if (!script) {
    process.stderr.write(
      `Unsupported shell "${shell ?? ""}". Supported shells: ${COMPLETION_SHELLS.join(", ")}`
    );
    process.exit(1);
  }

  process.stdout.write(ensureTrailingNewline(script));
  process.exit(0);
}

process.env.DOTENV_CONFIG_SILENT ??= "true";

await import("./cli");
