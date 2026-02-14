import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { type CompletionShell, renderCompletionScript } from "./completions";

export type WaitForServerReadyConfig = {
  url: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
};

const sleep = (ms: number) =>
  new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });

export const waitForServerReady = async ({
  url,
  timeoutMs = 10_000,
  intervalMs = 500,
  fetchImpl = fetch,
}: WaitForServerReadyConfig): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let response: Response | null = null;
    try {
      response = await fetchImpl(url, { method: "GET" });
    } catch {
      response = null;
    }

    if (response?.ok) {
      return true;
    }

    await sleep(intervalMs);
  }
  return false;
};

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
