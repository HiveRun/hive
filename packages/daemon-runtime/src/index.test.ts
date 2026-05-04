import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  extractPortFromUrl,
  findListeningProcessId,
  isHiveHealthResponse,
  waitForServerReady,
} from "./index";

const HIVE_PORT = 3000;
const UNIX_HIVE_PID = 401_148;
const HEALTHCHECK = "http://localhost:3000/health";

const waitForHiveHealth = (
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
) =>
  waitForServerReady({
    fetchImpl,
    intervalMs: 5,
    timeoutMs: 50,
    url: HEALTHCHECK,
    isReadyResponse: async (response) =>
      isHiveHealthResponse(await response.json()),
  });

const createReadyFileFixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "hive-daemon-ready-"));
  return { directory, file: join(directory, "daemon-ready") };
};

describe("daemon runtime utilities", () => {
  it("waits for a Hive-shaped health response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "ok" }))
      .mockResolvedValueOnce(Response.json({ service: "hive", status: "ok" }));

    const ready = await waitForHiveHealth(fetchMock);

    expect(ready).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts a ready file that matches the launched process", async () => {
    const readyFile = createReadyFileFixture();

    setTimeout(() => {
      writeFileSync(readyFile.file, "1234\n", "utf8");
    }, 10);

    const ready = await waitForServerReady({
      fetchImpl: vi.fn().mockRejectedValue(new Error("unreachable")),
      intervalMs: 5,
      readyFileContents: "1234",
      readyFilePath: readyFile.file,
      timeoutMs: 50,
      url: HEALTHCHECK,
    });

    expect(ready).toBe(true);
    rmSync(readyFile.directory, { recursive: true, force: true });
  });

  it("finds unix listening process ids from lsof output", () => {
    const runCommand = vi.fn().mockReturnValue({
      status: 0,
      stdout: `${UNIX_HIVE_PID}\n`,
    });

    expect(
      findListeningProcessId({
        platform: "linux",
        port: HIVE_PORT,
        runCommand,
      })
    ).toBe(UNIX_HIVE_PID);
  });

  it("extracts explicit URL ports", () => {
    expect(extractPortFromUrl("http://localhost:3000/health")).toBe(HIVE_PORT);
  });
});
