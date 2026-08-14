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

const createNamedViewerService = (title: string) => ({
  type: "process",
  run: `bun -e "Bun.serve({ port: Number(process.env.PORT), fetch() { return new Response('control'); } }); Bun.serve({ port: Number(process.env.WEB_BROWSER_PORT), fetch() { return new Response('<title>${title}</title><h1>${title}</h1>', { headers: { 'content-type': 'text/html' } }); } });"`,
  ports: {
    control: { primary: true, protocol: "tcp" },
    browser: { protocol: "http" },
  },
  readiness: {
    checks: [
      { type: "tcp", port: "control" },
      { type: "http", port: "browser" },
    ],
  },
});

const asBunCommand = (source: string) => `bun -e '${source}'`;
const portReference = (target: string) => `\${PORT:${target}}`;

const createServicesTemplate = () => ({
  id: "e2e-services-template",
  label: "E2E Services Template",
  type: "manual",
  teardown: [
    asBunCommand(
      'const { existsSync, writeFileSync } = require("node:fs"); if (!existsSync(process.env.HIVE_CELL_RUNTIME_DIR + "/worker-ready.json")) throw new Error("worker marker missing during teardown"); const record = { cellId: process.env.HIVE_CELL_ID, runtimeDir: process.env.HIVE_CELL_RUNTIME_DIR, artifactsDir: process.env.HIVE_CELL_ARTIFACTS_DIR, hiveHome: process.env.HIVE_HOME, reason: process.env.HIVE_TEARDOWN_REASON, ports: { database: process.env.DATABASE_POSTGRES_PORT, databasePrimary: process.env.DATABASE_PORT, apiHttp: process.env.API_HTTP_PORT, apiPrimary: process.env.API_PORT, apiMetrics: process.env.API_METRICS_PORT, worker: process.env.WORKER_CONTROL_PORT, workerPrimary: process.env.WORKER_PORT } }; writeFileSync(process.env.HIVE_CELL_ARTIFACTS_DIR + "/teardown.json", JSON.stringify(record));'
    ),
    asBunCommand(
      'const { appendFileSync, existsSync } = require("node:fs"); const path = process.env.HIVE_CELL_ARTIFACTS_DIR + "/teardown.json"; if (!existsSync(path)) throw new Error("teardown record missing"); appendFileSync(path, "\\ncomplete");'
    ),
  ],
  services: {
    database: {
      type: "process",
      run: asBunCommand(
        'const { writeFileSync } = require("node:fs"); writeFileSync(process.env.HIVE_CELL_RUNTIME_DIR + "/database-ready.json", JSON.stringify({ port: process.env.PORT, namedPort: process.env.DATABASE_POSTGRES_PORT, runtimeDir: process.env.HIVE_CELL_RUNTIME_DIR })); Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch() { return new Response("database"); } });'
      ),
      ports: {
        postgres: { primary: true, protocol: "tcp" },
      },
      readiness: {
        checks: [{ type: "tcp", port: "postgres" }],
      },
    },
    api: {
      type: "process",
      run: asBunCommand(
        'const { existsSync, writeFileSync } = require("node:fs"); if (!existsSync(process.env.HIVE_CELL_RUNTIME_DIR + "/database-ready.json")) throw new Error("database started out of order"); if (process.env.DB_PORT !== process.env.DATABASE_POSTGRES_PORT) throw new Error("database port interpolation failed"); if (process.env.METRICS_PORT !== process.env.API_METRICS_PORT) throw new Error("metrics port interpolation failed"); writeFileSync(process.env.HIVE_CELL_RUNTIME_DIR + "/api-ready.json", JSON.stringify({ databasePort: process.env.DB_PORT, httpPort: process.env.API_HTTP_PORT, primaryPort: process.env.PORT, metricsPort: process.env.METRICS_PORT, runtimeDir: process.env.HIVE_CELL_RUNTIME_DIR, artifactsDir: process.env.HIVE_CELL_ARTIFACTS_DIR, hiveHome: process.env.HIVE_HOME })); Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.API_HTTP_PORT), fetch(request) { return new Response(new URL(request.url).pathname === "/health" ? "ok" : "api"); } }); Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.API_METRICS_PORT), fetch() { return new Response("metrics"); } });'
      ),
      ports: {
        http: { primary: true, protocol: "http" },
        metrics: { protocol: "tcp" },
      },
      env: {
        DB_PORT: portReference("database:postgres"),
        METRICS_PORT: portReference("api:metrics"),
      },
      dependsOn: ["database"],
      readiness: {
        checks: [
          { type: "http", port: "http", path: "/health" },
          { type: "tcp", port: "metrics" },
        ],
      },
    },
    worker: {
      type: "process",
      run: asBunCommand(
        'const { existsSync, writeFileSync } = require("node:fs"); if (!existsSync(process.env.HIVE_CELL_RUNTIME_DIR + "/api-ready.json")) throw new Error("api started out of order"); writeFileSync(process.env.HIVE_CELL_RUNTIME_DIR + "/worker-ready.json", JSON.stringify({ apiPort: process.env.API_HTTP_PORT, controlPort: process.env.WORKER_CONTROL_PORT })); Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch() { return new Response("worker"); } });'
      ),
      ports: {
        control: { primary: true, protocol: "tcp" },
      },
      dependsOn: ["api"],
      readiness: {
        checks: [{ type: "tcp", port: "control" }],
      },
    },
  },
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
            "e2e-services-template": createServicesTemplate(),
          }
        : {}),
      "viewer-template": {
        id: "viewer-template",
        label: "Viewer Template",
        type: "manual",
        services: {
          web: createNamedViewerService("Viewer Web"),
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
