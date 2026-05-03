import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveRuntimePaths(moduleUrl: string) {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const e2eRoot = join(moduleDir, "..", "..");
  const repoRoot = join(e2eRoot, "..", "..");

  return {
    e2eRoot,
    repoRoot,
    serverRoot: join(repoRoot, "apps", "server"),
    stableArtifactsDir: join(e2eRoot, "reports", "latest"),
  };
}

export function createPlaywrightArgs(spec: string | undefined): string[] {
  return [
    "playwright",
    "test",
    "--config",
    "playwright.config.ts",
    ...(spec ? [spec] : []),
  ];
}

export function parseSpecArg(argv: string[]): string | undefined {
  const specIndex = argv.indexOf("--spec");
  return specIndex >= 0 ? argv[specIndex + 1] : undefined;
}
