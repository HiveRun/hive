import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { services as hiveServicesTool } from "../../agents/tools/hive";

async function createTempWorktree(): Promise<string> {
  return await fs.mkdtemp(join(tmpdir(), "hive-tool-test-"));
}

async function writeHiveToolConfig(args: {
  worktreePath: string;
  cellId: string;
  hiveUrl: string;
}): Promise<void> {
  const dir = join(args.worktreePath, ".hive");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, "config.json"),
    JSON.stringify({ cellId: args.cellId, hiveUrl: args.hiveUrl }, null, 2),
    "utf-8"
  );
}

describe("Hive OpenCode tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes portReachable in hive services output", async () => {
    const worktreePath = await createTempWorktree();
    const cellId = "test-cell";
    const hiveUrl = "http://hive.local";

    await writeHiveToolConfig({ worktreePath, cellId, hiveUrl });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        let url: string;
        if (typeof input === "string") {
          url = input;
        } else if (input instanceof URL) {
          url = input.toString();
        } else {
          url = input.url;
        }

        expect(url).toContain(`${hiveUrl}/api/cells/${cellId}/services`);
        expect(init?.signal).toBeDefined();

        const payload = {
          services: [
            {
              id: "service-1",
              name: "server",
              type: "process",
              status: "running",
              port: 39_993,
              command: "bun run dev",
              cwd: "/tmp",
              env: {},
              updatedAt: new Date().toISOString(),
              processAlive: true,
              portReachable: true,
            },
          ],
        };

        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      });

    const controller = new AbortController();
    const output = await hiveServicesTool.execute(
      { includeLogs: false, format: "text" },
      {
        sessionID: "session",
        messageID: "message",
        agent: "test",
        directory: worktreePath,
        worktree: worktreePath,
        abort: controller.signal,
        metadata() {
          // no-op for tests
        },
        ask: async () => {
          // no-op for tests
        },
      }
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(output).toContain("Service: server");
    expect(output).toContain("Port reachable: yes");

    await fs.rm(worktreePath, { recursive: true, force: true });
  });
});
