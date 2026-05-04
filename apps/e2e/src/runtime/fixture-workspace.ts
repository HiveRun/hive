import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "./process";

type FixtureWorkspaceOptions = {
  workspaceRoot: string;
  readmeTitle: string;
  commitMessage: string;
  includeServicesTemplate?: boolean;
  includeSetupRetryTemplate?: boolean;
};

const createViewerService = (title: string) => ({
  type: "process",
  run: `bun -e "Bun.serve({ port: Number(process.env.PORT), fetch() { return new Response('<title>${title}</title><h1>${title}</h1>', { headers: { 'content-type': 'text/html' } }); } });"`,
});

export async function createFixtureWorkspace(
  options: FixtureWorkspaceOptions
): Promise<void> {
  await mkdir(options.workspaceRoot, { recursive: true });

  const hiveConfig = {
    opencode: {
      defaultModel: "big-pickle",
      defaultProvider: "opencode",
    },
    defaults: {
      templateId: "e2e-template",
    },
    templates: {
      "e2e-template": {
        id: "e2e-template",
        label: "E2E Template",
        type: "manual",
        agent: {
          modelId: "big-pickle",
          providerId: "opencode",
        },
      },
      ...(options.includeServicesTemplate
        ? {
            "e2e-services-template": {
              id: "e2e-services-template",
              label: "E2E Services Template",
              type: "manual",
              services: {
                api: {
                  type: "process",
                  run: "tail -f /dev/null",
                },
                worker: {
                  type: "process",
                  run: "tail -f /dev/null",
                },
              },
            },
          }
        : {}),
      "viewer-template": {
        id: "viewer-template",
        label: "Viewer Template",
        type: "manual",
        services: {
          web: createViewerService("Viewer Web"),
          docs: createViewerService("Viewer Docs"),
        },
      },
      ...(options.includeSetupRetryTemplate
        ? {
            "e2e-setup-retry-template": {
              id: "e2e-setup-retry-template",
              label: "E2E Setup Retry Template",
              type: "manual",
              setup: [
                'test -f "$HIVE_MAIN_REPO/.hive-setup-pass" || { echo "marker missing: $HIVE_MAIN_REPO/.hive-setup-pass" >&2; exit 37; }',
              ],
            },
          }
        : {}),
    },
  };

  await writeFile(
    join(options.workspaceRoot, "hive.config.json"),
    `${JSON.stringify(hiveConfig, null, 2)}\n`,
    "utf8"
  );

  await writeFile(
    join(options.workspaceRoot, "@opencode.json"),
    `${JSON.stringify({ model: "opencode/big-pickle" }, null, 2)}\n`,
    "utf8"
  );

  await writeFile(
    join(options.workspaceRoot, "README.md"),
    `# ${options.readmeTitle}\n`,
    "utf8"
  );

  if (options.includeSetupRetryTemplate) {
    await writeFile(
      join(options.workspaceRoot, ".hive-setup-pass"),
      "ok\n",
      "utf8"
    );
  }

  await runCommand("git", ["init"], {
    cwd: options.workspaceRoot,
    label: "Initialize fixture git repository",
  });
  await runCommand("git", ["add", "."], {
    cwd: options.workspaceRoot,
    label: "Stage fixture files",
  });
  await runCommand(
    "git",
    [
      "-c",
      "user.name=Hive E2E",
      "-c",
      "user.email=hive-e2e@example.com",
      "commit",
      "-m",
      options.commitMessage,
    ],
    {
      cwd: options.workspaceRoot,
      label: "Create fixture commit",
    }
  );
}
