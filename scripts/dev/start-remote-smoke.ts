import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "./local-hive-home";

const repoRoot = resolveWorkspaceRoot(process.cwd());
const composeFile = join(repoRoot, "deploy", "docker", "docker-compose.yml");
const opencodeConfigDir = join(repoRoot, "deploy", "docker", "opencode");

const PROJECT_NAME =
  process.env.HIVE_LOCAL_REMOTE_PROJECT_NAME ?? "hive-local-remote";
const PORT = process.env.HIVE_LOCAL_REMOTE_PORT ?? "3100";
const PUBLIC_URL =
  process.env.HIVE_LOCAL_REMOTE_URL ?? `http://127.0.0.1:${PORT}`;
const WORKSPACE_PATH = "/workspaces/local-smoke";
const TEMPLATE_ID = "local-smoke-template";

const args = new Set(process.argv.slice(2));
const shouldBuild =
  !args.has("--no-build") && process.env.HIVE_LOCAL_REMOTE_BUILD !== "0";

const composeEnv = {
  ...process.env,
  HIVE_INSTANCE_NAME: "Local Private Remote Hive",
  HIVE_LOCAL_PORT: PORT,
  HIVE_OPENCODE_CONFIG_DIR: opencodeConfigDir,
  HIVE_PUBLIC_API_URL: PUBLIC_URL,
  HIVE_PUBLIC_WEB_URL: PUBLIC_URL,
};

type WorkspaceRegistration = { workspace?: { id?: string } };
type TemplatesResult = {
  defaults?: { templateId?: string };
  templates?: Array<{ id: string }>;
};

const usage = `Usage:
  bun run dev:remote              Start local private-remote smoke instance
  bun run dev:remote -- --reset   Recreate containers and volumes first
  bun run dev:remote -- --no-build Skip Docker image rebuild
  bun run dev:remote:down         Stop and delete local smoke containers/volumes

Environment:
  HIVE_LOCAL_REMOTE_PORT=3100
  HIVE_LOCAL_REMOTE_PROJECT_NAME=hive-local-remote
`;

async function main() {
  if (args.has("--help") || args.has("-h")) {
    process.stdout.write(usage);
    return;
  }

  await mkdir(opencodeConfigDir, { recursive: true });

  if (args.has("--down")) {
    await runCompose(["down", "-v", "--remove-orphans"]);
    process.stdout.write("Stopped local private-remote smoke instance.\n");
    return;
  }

  if (args.has("--reset")) {
    await runCompose(["down", "-v", "--remove-orphans"]);
  }

  await runCompose(["up", "-d", ...(shouldBuild ? ["--build"] : [])]);
  await Bun.$`curl --fail --silent --show-error --retry 180 --retry-delay 1 --retry-connrefused ${PUBLIC_URL}/health`.quiet();
  await seedWorkspace();
  const workspace = await registerWorkspace();
  const templates = await loadTemplates(workspace.id);
  const templateIds = templates.templates?.map((template) => template.id) ?? [];

  if (templates.defaults?.templateId !== TEMPLATE_ID) {
    throw new Error(
      `Expected default template '${TEMPLATE_ID}', got '${templates.defaults?.templateId ?? "none"}'`
    );
  }

  if (!templateIds.includes(TEMPLATE_ID)) {
    throw new Error(`Template '${TEMPLATE_ID}' was not listed by the API`);
  }

  printSummary(workspace.id);
}

async function runCompose(composeCommandArgs: string[], capture = false) {
  const command = [
    "docker",
    "compose",
    "-p",
    PROJECT_NAME,
    "-f",
    composeFile,
    ...composeCommandArgs,
  ];
  const process = Bun.spawn({
    cmd: command,
    cwd: repoRoot,
    env: composeEnv,
    stderr: capture ? "pipe" : "inherit",
    stdout: capture ? "pipe" : "inherit",
  });
  if (!capture) {
    const inheritedExitCode = await process.exited;
    if (inheritedExitCode !== 0) {
      throw new Error(`Command failed: ${command.join(" ")}`);
    }
    return "";
  }

  const [exitCode, output, errorOutput] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${errorOutput.trim()}`);
  }
  return output.trim();
}

async function seedWorkspace() {
  const hiveConfig = JSON.stringify(buildHiveConfig(), null, 2);
  const setupScript = `
set -eu
rm -rf ${WORKSPACE_PATH}
mkdir -p ${WORKSPACE_PATH}
cd ${WORKSPACE_PATH}
cat > hive.config.json <<'JSON'
${hiveConfig}
JSON
cat > @opencode.json <<'JSON'
{"model":"opencode/big-pickle"}
JSON
cat > README.md <<'EOF'
# Local Remote Smoke Workspace

Created by \`bun run dev:remote\`.
EOF
git init >/dev/null
git add .
git -c user.name='Hive Local Smoke' -c user.email='hive-local-smoke@example.com' commit -m 'initial local smoke workspace' >/dev/null
`;
  await runCompose(["exec", "-T", "hive", "sh", "-lc", setupScript], true);
}

function buildHiveConfig() {
  return {
    opencode: {
      defaultProvider: "opencode",
      defaultModel: "big-pickle",
      defaultMode: "plan",
    },
    defaults: {
      templateId: TEMPLATE_ID,
      startMode: "plan",
    },
    promptSources: [],
    templates: {
      [TEMPLATE_ID]: {
        id: TEMPLATE_ID,
        label: "Local Remote Smoke",
        type: "manual",
        agent: {
          providerId: "opencode",
          modelId: "big-pickle",
        },
        services: {
          preview: {
            type: "process",
            run: 'python3 -m http.server "$PORT" --bind 0.0.0.0',
            readyTimeoutMs: 3000,
          },
        },
      },
    },
  };
}

async function registerWorkspace() {
  const response = await fetch(`${PUBLIC_URL}/api/workspaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activate: true,
      label: "Local Remote Smoke",
      path: WORKSPACE_PATH,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to register workspace: HTTP ${response.status}\n${body}`
    );
  }

  const payload = JSON.parse(body) as WorkspaceRegistration;
  if (!payload.workspace?.id) {
    throw new Error("Workspace registration response did not include an id");
  }
  return payload.workspace;
}

async function loadTemplates(workspaceId: string | undefined) {
  if (!workspaceId) {
    throw new Error("Workspace id is required to load templates");
  }

  const response = await fetch(
    `${PUBLIC_URL}/api/templates?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to load templates: HTTP ${response.status}\n${body}`
    );
  }
  return JSON.parse(body) as TemplatesResult;
}

function printSummary(workspaceId: string | undefined) {
  process.stdout.write(`
Local private-remote Hive is ready.

Web UI:
  ${PUBLIC_URL}

Seeded workspace:
  ${WORKSPACE_PATH}

Active workspace id:
  ${workspaceId ?? "unknown"}

Try next:
  1. Open ${PUBLIC_URL}
  2. Create a cell with the "Local Remote Smoke" template
  3. Open the preview service from the cell page

Desktop source smoke:
  bun run --cwd apps/web build
  HIVE_DESKTOP_BACKEND_URL=${PUBLIC_URL} HIVE_DESKTOP_HEALTH_URL=${PUBLIC_URL}/health HIVE_DESKTOP_INSTANCE_NAME=local-remote HIVE_DESKTOP_STARTUP_MODE=remote-client HIVE_DESKTOP_RENDERER_PATH="$PWD/apps/web/dist/index.html" bun run --cwd apps/desktop-electron start

Fast rerun without rebuild:
  bun run dev:remote -- --no-build

Reset all local remote smoke state:
  bun run dev:remote -- --reset

Stop and delete local remote smoke state:
  bun run dev:remote:down
`);
}

main().catch((error) => {
  process.stderr.write(
    `Failed to start local private-remote smoke instance: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
