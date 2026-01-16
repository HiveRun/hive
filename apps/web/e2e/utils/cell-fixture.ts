import { base, en, Faker } from "@faker-js/faker";
import type {
  Cell,
  CellDiffResponse,
  CellServiceSummary,
} from "@/queries/cells";

const FIXTURE_SEED = 20_251_108;
const DEFAULT_OPENCODE_PORT = 5000;
const DEFAULT_SERVICE_PORT = 3000;

const cellFaker = new Faker({ locale: [en, base] });

cellFaker.seed(FIXTURE_SEED);

export type CellFixture = Cell;

export function createCellFixture(
  overrides: Partial<CellFixture> = {}
): CellFixture {
  const id = overrides.id ?? cellFaker.string.uuid();

  const cellBase: CellFixture = {
    id,
    name:
      overrides.name ??
      cellFaker.helpers.arrayElement([
        "Snapshot Cell",
        "Hive Runtime",
        "Forest Engine",
      ]),
    description:
      overrides.description ??
      cellFaker.helpers.maybe(
        () => cellFaker.lorem.sentence({ min: 6, max: 12 }),
        {
          probability: 0.6,
        }
      ) ??
      null,
    templateId: overrides.templateId ?? "hive-dev",
    workspacePath: overrides.workspacePath ?? `/home/hive/.hive/cells/${id}`,
    workspaceId: overrides.workspaceId ?? "workspace-primary",
    workspaceRootPath:
      overrides.workspaceRootPath ?? "/home/aureatus/dev/projects/hive",
    opencodeSessionId: overrides.opencodeSessionId ?? cellFaker.string.uuid(),
    opencodeServerUrl: overrides.opencodeServerUrl ?? "http://127.0.0.1:5000",
    opencodeServerPort: overrides.opencodeServerPort ?? DEFAULT_OPENCODE_PORT,
    opencodeCommand: overrides.opencodeCommand ?? null,
    createdAt:
      overrides.createdAt ??
      cellFaker.date
        .past({ years: 1, refDate: "2024-01-01T00:00:00.000Z" })
        .toISOString(),
    status: overrides.status ?? "ready",
    phase: overrides.phase ?? "implementation",
    lastSetupError: overrides.lastSetupError,
  };

  return { ...cellBase, ...overrides };
}

export const cellSnapshotFixture: CellFixture[] = [
  createCellFixture({
    id: "snapshot-cell",
    name: "Snapshot Cell",
    description: "Deterministic fixture used for visual regression tests.",
    workspacePath: "/home/hive/.hive/cells/snapshot-cell",
    workspaceId: "workspace-primary",
    workspaceRootPath: "/home/aureatus/dev/projects/hive",
    createdAt: "2024-01-01T12:00:00.000Z",
  }),
];

export type CellServiceFixture = CellServiceSummary;

export function createServiceFixture(
  overrides: Partial<CellServiceFixture> = {}
): CellServiceFixture {
  const id = overrides.id ?? cellFaker.string.uuid();
  return {
    id,
    name: overrides.name ?? "web",
    type: overrides.type ?? "process",
    status: overrides.status ?? "running",
    port: overrides.port ?? DEFAULT_SERVICE_PORT,
    pid: overrides.pid ?? cellFaker.number.int({ min: 10_000, max: 20_000 }),
    command: overrides.command ?? "bun run dev",
    cwd: overrides.cwd ?? ".",
    logPath:
      overrides.logPath ??
      `/home/hive/.hive/cells/${id}/logs/${overrides.name ?? "web"}.log`,
    lastKnownError: overrides.lastKnownError ?? null,
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
    env: overrides.env ?? {},
    recentLogs: overrides.recentLogs ?? "No log output yet.",
  };
}

export const cellServiceSnapshotFixture: Record<string, CellServiceFixture[]> =
  {
    "snapshot-cell": [
      createServiceFixture({
        id: "snapshot-service-web",
        name: "web",
        status: "running",
      }),
      createServiceFixture({
        id: "snapshot-service-server",
        name: "server",
        status: "error",
        lastKnownError: "Exited with code 1",
        recentLogs: "error: Cannot find module 'pino'",
      }),
    ],
  };

const DIFF_LONG_LINE_REPEAT = 60;
const LONG_LINE_BEFORE = `const renderOutput = "${"initial-value-".repeat(DIFF_LONG_LINE_REPEAT)}";`;
const LONG_LINE_AFTER = `const renderOutput = "${"initial-value-".repeat(DIFF_LONG_LINE_REPEAT)}_diff";`;

export const cellDiffSnapshotFixture: Record<string, CellDiffResponse> = {
  "snapshot-cell": {
    mode: "workspace",
    baseCommit: "abc1234",
    headCommit: "def5678",
    files: [
      {
        path: "src/app/long-file.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
      },
      {
        path: "README.md",
        status: "added",
        additions: 5,
        deletions: 0,
      },
    ],
    details: [
      {
        path: "src/app/long-file.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        beforeContent: LONG_LINE_BEFORE,
        afterContent: LONG_LINE_AFTER,
        patch: `diff --git a/src/app/long-file.ts b/src/app/long-file.ts\n@@ -1,2 +1,2 @@\n-${LONG_LINE_BEFORE}\n+${LONG_LINE_AFTER}\n`,
      },
      {
        path: "README.md",
        status: "added",
        additions: 5,
        deletions: 0,
        beforeContent: "",
        afterContent:
          "# Snapshot\n\nNew content for the README diff example.\n",
        patch:
          "diff --git a/README.md b/README.md\n@@ -0,0 +1,3 @@\n+# Snapshot\n+\n+New content for the README diff example.\n",
      },
    ],
  },
};

export type CellDiffFixture = typeof cellDiffSnapshotFixture;
