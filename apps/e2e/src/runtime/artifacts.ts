import { cp, mkdir, rm } from "node:fs/promises";

export async function publishArtifacts(
  sourceArtifactsDir: string,
  targetArtifactsDir: string
): Promise<void> {
  await rm(targetArtifactsDir, { recursive: true, force: true });
  await mkdir(targetArtifactsDir, { recursive: true });
  await cp(sourceArtifactsDir, targetArtifactsDir, { recursive: true });
}

export async function finishRuntimeRun(options: {
  artifactsDir: string;
  keepArtifacts: boolean;
  reportsLabel: string;
  runRoot: string;
  runSucceeded: boolean;
  runArtifactsLabel: string;
  stableArtifactsDir: string;
}): Promise<void> {
  await publishArtifacts(options.artifactsDir, options.stableArtifactsDir);
  process.stdout.write(
    `${options.reportsLabel}: ${options.stableArtifactsDir}\n`
  );

  if (!options.keepArtifacts && options.runSucceeded) {
    await rm(options.runRoot, { recursive: true, force: true });
  } else {
    process.stdout.write(`${options.runArtifactsLabel}: ${options.runRoot}\n`);
  }
}
