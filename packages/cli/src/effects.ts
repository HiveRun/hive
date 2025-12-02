import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Effect } from "effect";

import { type CompletionShell, renderCompletionScript } from "./completions";

export type WaitForServerReadyConfig = {
  url: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
};

const sleepEffect = (ms: number) =>
  Effect.async<void>((resume) => {
    const timer = setTimeout(() => resume(Effect.succeed(undefined)), ms);
    return Effect.sync(() => clearTimeout(timer));
  });

export const waitForServerReadyEffect = ({
  url,
  timeoutMs = 10_000,
  intervalMs = 500,
  fetchImpl = fetch,
}: WaitForServerReadyConfig) =>
  Effect.gen(function* () {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = yield* Effect.catchAll(
        Effect.tryPromise({
          try: () => fetchImpl(url, { method: "GET" }),
          catch: (cause) =>
            cause instanceof Error ? cause : new Error(String(cause)),
        }),
        () => Effect.succeed<Response | null>(null)
      );

      if (response?.ok) {
        return true;
      }

      yield* sleepEffect(intervalMs);
    }
    return false;
  });

export const ensureTrailingNewline = (script: string) =>
  script.endsWith("\n") ? script : `${script}\n`;

export const installCompletionScript = (
  shell: CompletionShell,
  targetPath: string
) => {
  const script = renderCompletionScript(shell);
  if (!script) {
    return { ok: false, message: `Unsupported shell "${shell}".` } as const;
  }

  const resolvedPath = resolve(targetPath);
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

export const installCompletionScriptEffect = (
  shell: CompletionShell,
  targetPath: string
) =>
  Effect.try({
    try: () => installCompletionScript(shell, targetPath),
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });
