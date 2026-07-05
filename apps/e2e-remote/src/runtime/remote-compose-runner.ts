import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = new URL("../../../..", import.meta.url).pathname;
const composeFile = join(repoRoot, "deploy", "docker", "docker-compose.yml");
const cliRoot = join(repoRoot, "packages", "cli");
const STARTUP_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 1000;
const E2E_PORT_BASE = 35_000;
const E2E_PORT_SPAN = 1000;
const FULL_FLOW_TIMEOUT_MS = 180_000;
const REMOTE_WORKSPACE_PATH = "/workspaces/remote-e2e-full-flow";
const REMOTE_TEMPLATE_ID = "remote-e2e-template";
const shouldBuildImage = process.env.HIVE_REMOTE_E2E_BUILD !== "0";

const runId = `${process.pid}-${Date.now()}`;
const projectName = `hive-remote-e2e-${runId}`;

const run = async (
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {}
) => {
  const child = Bun.spawn({
    cmd: args,
    cwd: repoRoot,
    env: options.env ?? process.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`Command failed: ${args.join(" ")}`);
  }
};

const runCapture = async (
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
) => {
  const child = Bun.spawn({
    cmd: args,
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    throw new Error(
      `Command failed: ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`
    );
  }
  return stdout.trim();
};

const composeArgs = (args: string[]) => [
  "docker",
  "compose",
  "-p",
  projectName,
  "-f",
  composeFile,
  ...args,
];

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const waitForHealth = async (url: string) => {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  );
};

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message);
  }
};

type InstanceResponse = {
  apiBaseUrl?: string;
  capabilities?: { publicInternetSafe?: boolean };
  id?: string;
  mode?: string;
  name?: string;
  warnings?: string[];
};

type WorkspaceRecord = {
  id: string;
  label: string;
  path: string;
};

type WorkspaceMutationResponse = {
  workspace?: WorkspaceRecord;
};

type WorkspaceListResponse = {
  activeWorkspaceId?: string | null;
  workspaces?: WorkspaceRecord[];
};

type TemplateListResponse = {
  defaults?: { templateId?: string };
  templates?: Array<{ id: string; label: string }>;
};

type CellResponse = {
  id: string;
  name: string;
  opencodeSessionId?: string | null;
  status: string;
  templateId: string;
  workspaceId: string;
  workspacePath: string;
  workspaceRootPath: string;
  lastSetupError?: string | null;
};

type CellListResponse = {
  cells?: CellResponse[];
};

type CellServiceResponse = {
  browserUrl?: string;
  id: string;
  name: string;
  port?: number;
  portReachable?: boolean;
  processAlive?: boolean;
  status: string;
};

type CellServiceListResponse = {
  services?: CellServiceResponse[];
};

type InstanceOverviewResponse = {
  cells?: { total?: number; byStatus?: Record<string, number> };
  services?: { total?: number; byStatus?: Record<string, number> };
  workspaces?: { total?: number; activeWorkspaceId?: string | null };
};

const jsonHeaders = { "content-type": "application/json" };

const fetchJson = async <T>(
  url: string,
  options: RequestInit,
  message: string
): Promise<T> => {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${message}: HTTP ${response.status}\n${body}`);
  }
  return (body ? JSON.parse(body) : null) as T;
};

const getJson = async <T>(url: string, message: string): Promise<T> =>
  await fetchJson<T>(url, {}, message);

const postJson = async <T>(
  url: string,
  body: unknown,
  message: string
): Promise<T> =>
  await fetchJson<T>(
    url,
    {
      body: JSON.stringify(body),
      headers: jsonHeaders,
      method: "POST",
    },
    message
  );

const waitForCellReady = async (
  publicUrl: string,
  cellId: string
): Promise<CellResponse> => {
  const startedAt = Date.now();
  let latest: CellResponse | null = null;
  while (Date.now() - startedAt < FULL_FLOW_TIMEOUT_MS) {
    latest = await getJson<CellResponse>(
      `${publicUrl}/api/cells/${encodeURIComponent(cellId)}?includeSetupLog=false`,
      "cell should be readable during provisioning"
    );
    if (latest.status === "ready") {
      return latest;
    }
    if (latest.status === "error") {
      throw new Error(
        `cell entered error status: ${latest.lastSetupError ?? "no setup error provided"}`
      );
    }
    await wait(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for cell ${cellId} to become ready; latest status ${latest?.status ?? "unknown"}`
  );
};

const waitForPreviewService = async (
  publicUrl: string,
  cellId: string
): Promise<CellServiceResponse> => {
  const startedAt = Date.now();
  let latest: CellServiceResponse | null = null;
  while (Date.now() - startedAt < FULL_FLOW_TIMEOUT_MS) {
    const payload = await getJson<CellServiceListResponse>(
      `${publicUrl}/api/cells/${encodeURIComponent(cellId)}/services?includeResources=true`,
      "cell services should be readable"
    );
    latest =
      payload.services?.find((service) => service.name === "preview") ?? null;
    if (
      latest?.status === "running" &&
      latest.processAlive === true &&
      latest.portReachable === true &&
      latest.browserUrl
    ) {
      return latest;
    }
    await wait(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for preview service; latest status ${latest?.status ?? "missing"}; last error ${latest?.lastKnownError ?? "none"}`
  );
};

const assertPreviewProxy = async (
  service: CellServiceResponse,
  expectedCellId: string,
  publicUrl: string
) => {
  assert(service.browserUrl, "preview service should expose browserUrl");
  assert(
    service.browserUrl.startsWith(
      `${publicUrl}/api/cells/${expectedCellId}/services/`
    ),
    "preview browserUrl should be routed through the public Hive API URL"
  );

  const response = await fetch(`${service.browserUrl}probe?source=remote-e2e`, {
    body: "remote-proxy-check",
    headers: {
      authorization: "Bearer should-not-forward",
      "cf-access-client-id": "should-not-forward",
      "content-type": "text/plain",
      cookie: "should-not-forward=true",
    },
    method: "POST",
  });
  const bodyText = await response.text();
  assert(
    response.ok,
    `preview proxy should return success, got HTTP ${response.status}: ${bodyText}`
  );
  const body = JSON.parse(bodyText) as {
    authorization?: string | null;
    body?: string;
    cfAccessClientId?: string | null;
    cookie?: string | null;
    hiveCellId?: string;
    hiveService?: string;
    method?: string;
    path?: string;
    search?: string;
  };
  assert(body.method === "POST", "service proxy should preserve HTTP method");
  assert(
    body.path === "/probe",
    "service proxy should preserve forwarded path"
  );
  assert(
    body.search === "?source=remote-e2e",
    "service proxy should preserve forwarded query"
  );
  assert(
    body.body === "remote-proxy-check",
    "service proxy should forward body"
  );
  assert(
    body.hiveCellId === expectedCellId,
    "service should run inside the cell"
  );
  assert(
    body.hiveService === "preview",
    "service env should identify service name"
  );
  assert(
    body.authorization === null,
    "service proxy should strip authorization"
  );
  assert(body.cookie === null, "service proxy should strip cookies");
  assert(
    body.cfAccessClientId === null,
    "service proxy should strip Cloudflare Access client id"
  );
};

const buildRemoteFixtureConfig = () => {
  const serviceScript = [
    "import http.server,json,os,urllib.parse",
    "class Handler(http.server.BaseHTTPRequestHandler):",
    "  def do_POST(self):",
    "    length=int(self.headers.get('content-length','0') or '0')",
    "    body=self.rfile.read(length).decode()",
    "    parsed=urllib.parse.urlparse(self.path)",
    "    payload={'ok':True,'method':self.command,'path':parsed.path,'search':('?' + parsed.query) if parsed.query else '','body':body,'authorization':self.headers.get('authorization'),'cookie':self.headers.get('cookie'),'cfAccessClientId':self.headers.get('cf-access-client-id'),'hiveCellId':os.environ.get('HIVE_CELL_ID'),'hiveService':os.environ.get('HIVE_SERVICE')}",
    "    raw=json.dumps(payload).encode()",
    "    self.send_response(200)",
    "    self.send_header('content-type','application/json')",
    "    self.send_header('content-length',str(len(raw)))",
    "    self.end_headers()",
    "    self.wfile.write(raw)",
    "  def log_message(self, *args): pass",
    "http.server.ThreadingHTTPServer(('0.0.0.0', int(os.environ['PORT'])), Handler).serve_forever()",
  ].join("\n");

  return JSON.stringify(
    {
      opencode: {
        defaultModel: "big-pickle",
        defaultMode: "plan",
        defaultProvider: "opencode",
      },
      defaults: {
        startMode: "plan",
        templateId: REMOTE_TEMPLATE_ID,
      },
      promptSources: [],
      templates: {
        [REMOTE_TEMPLATE_ID]: {
          id: REMOTE_TEMPLATE_ID,
          label: "Remote E2E Template",
          type: "manual",
          agent: {
            modelId: "big-pickle",
            providerId: "opencode",
          },
          services: {
            preview: {
              type: "process",
              run: `python3 - <<'PY'\n${serviceScript}\nPY`,
              readyTimeoutMs: 3000,
            },
          },
        },
      },
    },
    null,
    2
  );
};

async function main() {
  const hiveHome = await mkdtemp(join(tmpdir(), "hive-remote-e2e-home-"));
  const port = String(E2E_PORT_BASE + (process.pid % E2E_PORT_SPAN));
  const publicUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    HIVE_INSTANCE_NAME: "Remote E2E Hive",
    HIVE_LOCAL_PORT: port,
    HIVE_OPENCODE_CONFIG_DIR: join(repoRoot, ".opencode"),
    HIVE_PUBLIC_API_URL: publicUrl,
    HIVE_PUBLIC_WEB_URL: publicUrl,
  };
  const execInHive = async (script: string) =>
    await runCapture(composeArgs(["exec", "-T", "hive", "sh", "-lc", script]), {
      env,
    });

  try {
    await run(
      composeArgs(["up", "-d", ...(shouldBuildImage ? ["--build"] : [])]),
      {
        env,
      }
    );
    await waitForHealth(`${publicUrl}/health`);

    const instance = await getJson<InstanceResponse>(
      `${publicUrl}/api/instance`,
      "instance metadata endpoint should be reachable"
    );
    assert(
      instance.name === "Remote E2E Hive",
      "instance name should match env"
    );
    assert(
      instance.mode === "private-remote",
      "instance should run in private-remote mode"
    );
    assert(
      instance.apiBaseUrl === publicUrl,
      "instance API URL should match public URL"
    );
    assert(
      instance.capabilities?.publicInternetSafe === false,
      "instance must not claim public internet safety"
    );
    assert(
      (instance.warnings ?? []).length > 0,
      "instance should expose private access warning"
    );
    const firstInstanceId = instance.id;

    const setupScript = `
      set -eu
      rm -rf ${REMOTE_WORKSPACE_PATH}
      mkdir -p ${REMOTE_WORKSPACE_PATH}
      cd ${REMOTE_WORKSPACE_PATH}
      cat > hive.config.json <<'JSON'
${buildRemoteFixtureConfig()}
JSON
      cat > @opencode.json <<'JSON'
{"model":"opencode/big-pickle"}
JSON
      cat > README.md <<'EOF'
# Remote E2E Workspace
EOF
      git init
      git add .
      git -c user.name='Hive Remote E2E' -c user.email='hive-remote-e2e@example.com' commit -m 'initial remote e2e fixture'
    `;
    await execInHive(setupScript);

    const browsePayload = await getJson<{
      directories?: Array<{ path: string; hasConfig: boolean }>;
    }>(
      `${publicUrl}/api/workspaces/browse?path=${encodeURIComponent("/workspaces")}`,
      "remote workspace browse should be allowed under /workspaces"
    );
    assert(
      browsePayload.directories?.some(
        (directory) =>
          directory.path === REMOTE_WORKSPACE_PATH &&
          directory.hasConfig === true
      ),
      "workspace browser should discover the remote fixture workspace"
    );

    const registered = await postJson<WorkspaceMutationResponse>(
      `${publicUrl}/api/workspaces`,
      {
        activate: true,
        label: "Remote E2E Workspace",
        path: REMOTE_WORKSPACE_PATH,
      },
      "remote workspace should register"
    );
    const workspace = registered.workspace;
    assert(workspace?.id, "registered workspace should include an id");
    assert(
      workspace.path === REMOTE_WORKSPACE_PATH,
      "registered workspace path should match remote fixture path"
    );

    const workspaceList = await getJson<WorkspaceListResponse>(
      `${publicUrl}/api/workspaces`,
      "workspace list should be readable after registration"
    );
    assert(
      workspaceList.activeWorkspaceId === workspace.id,
      "registered workspace should be active"
    );
    assert(
      workspaceList.workspaces?.some((entry) => entry.id === workspace.id),
      "registered workspace should appear in workspace list"
    );

    const templates = await getJson<TemplateListResponse>(
      `${publicUrl}/api/templates?workspaceId=${encodeURIComponent(workspace.id)}`,
      "templates should load for registered remote workspace"
    );
    assert(
      templates.defaults?.templateId === REMOTE_TEMPLATE_ID,
      "remote fixture default template should be exposed"
    );
    assert(
      templates.templates?.some(
        (template) => template.id === REMOTE_TEMPLATE_ID
      ),
      "remote fixture template should be listed"
    );

    const createdCell = await postJson<CellResponse>(
      `${publicUrl}/api/cells`,
      {
        name: "Remote full-flow cell",
        startMode: "plan",
        templateId: REMOTE_TEMPLATE_ID,
        workspaceId: workspace.id,
      },
      "remote cell should be created"
    );
    assert(createdCell.id, "created cell should include an id");
    assert(
      createdCell.workspaceId === workspace.id,
      "created cell should belong to remote fixture workspace"
    );
    assert(
      createdCell.templateId === REMOTE_TEMPLATE_ID,
      "created cell should use remote fixture template"
    );

    const readyCell = await waitForCellReady(publicUrl, createdCell.id);
    assert(
      readyCell.opencodeSessionId,
      "ready remote cell should have an OpenCode session"
    );
    assert(
      readyCell.workspacePath.startsWith("/home/hive/.hive/cells/"),
      "ready remote cell should run from the remote instance cell workspace"
    );
    assert(
      readyCell.workspaceRootPath === REMOTE_WORKSPACE_PATH,
      "ready remote cell should retain remote workspace root"
    );

    const previewService = await waitForPreviewService(
      publicUrl,
      createdCell.id
    );
    await assertPreviewProxy(previewService, createdCell.id, publicUrl);

    const overview = await getJson<InstanceOverviewResponse>(
      `${publicUrl}/api/instance/overview`,
      "instance overview should reflect full-flow resources"
    );
    assert(
      (overview.workspaces?.total ?? 0) >= 1,
      "instance overview should include registered workspace"
    );
    assert(
      (overview.cells?.total ?? 0) >= 1 &&
        (overview.cells?.byStatus?.ready ?? 0) >= 1,
      "instance overview should include ready cell"
    );
    assert(
      (overview.services?.total ?? 0) >= 1 &&
        (overview.services?.byStatus?.running ?? 0) >= 1,
      "instance overview should include running service"
    );

    const rootResponse = await fetch(publicUrl);
    assert(rootResponse.ok, "same-origin web UI should be reachable");
    assert(
      (await rootResponse.text()).includes('<div id="root"></div>'),
      "web UI should serve the built React shell"
    );

    const cliEnv = {
      ...process.env,
      HIVE_HOME: hiveHome,
    };
    await runCapture(
      ["bun", "src/index.ts", "instance", "add", "remote", publicUrl, "--use"],
      {
        cwd: cliRoot,
        env: cliEnv,
      }
    );
    const status = await runCapture(
      ["bun", "src/index.ts", "instance", "status"],
      {
        cwd: cliRoot,
        env: cliEnv,
      }
    );
    assert(
      status.includes("Remote E2E Hive"),
      "CLI status should read remote metadata"
    );

    await run(composeArgs(["restart", "hive"]), { env });
    await waitForHealth(`${publicUrl}/health`);
    const restarted = await getJson<InstanceResponse>(
      `${publicUrl}/api/instance`,
      "instance metadata should be readable after restart"
    );
    assert(
      restarted.id === firstInstanceId,
      "instance id should persist after container restart"
    );

    const restartedWorkspaces = await getJson<WorkspaceListResponse>(
      `${publicUrl}/api/workspaces`,
      "workspace registry should be readable after restart"
    );
    assert(
      restartedWorkspaces.activeWorkspaceId === workspace.id,
      "active remote workspace should persist after restart"
    );
    assert(
      restartedWorkspaces.workspaces?.some(
        (entry) => entry.id === workspace.id
      ),
      "registered remote workspace should persist after restart"
    );

    const restartedCells = await getJson<CellListResponse>(
      `${publicUrl}/api/cells?workspaceId=${encodeURIComponent(workspace.id)}`,
      "remote cells should be listable after restart"
    );
    const restartedCell = restartedCells.cells?.find(
      (cell) => cell.id === createdCell.id
    );
    assert(restartedCell, "created remote cell should persist after restart");
    assert(
      restartedCell?.status === "ready",
      "created remote cell should remain ready after restart"
    );

    const restartedService = await waitForPreviewService(
      publicUrl,
      createdCell.id
    );
    await assertPreviewProxy(restartedService, createdCell.id, publicUrl);
  } finally {
    await run(composeArgs(["down", "-v", "--remove-orphans"]), { env }).catch(
      (error) => {
        process.stderr.write(
          `Failed to clean remote E2E compose stack: ${String(error)}\n`
        );
      }
    );
    await rm(hiveHome, { force: true, recursive: true });
  }
}

await main().catch((error) => {
  process.stderr.write(
    `Remote Compose E2E failed: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
