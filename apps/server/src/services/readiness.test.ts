import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { describe, expect, it } from "vitest";
import { waitForServiceReadiness } from "./readiness";

const neverExits = new Promise<number>(() => {
  // Intentionally pending for readiness checks.
});
const HTTP_OK = 200;
const DEADLINE_TEST_CEILING_MS = 500;
const EARLY_EXIT_CODE = 17;

const workerReadiness = (options: {
  intervalMs: number;
  port: number;
  processExited: Promise<number>;
  timeoutMs: number;
}) => ({
  serviceName: "worker",
  readiness: {
    checks: [{ type: "tcp" as const, port: "control" }],
    intervalMs: options.intervalMs,
  },
  ports: new Map([["control", options.port]]),
  processExited: options.processExited,
  timeoutMs: options.timeoutMs,
});

describe("service readiness", () => {
  it("accepts a listening TCP port", async () => {
    const server = createTcpServer();
    const port = await listen(server);
    try {
      await waitForServiceReadiness({
        serviceName: "api",
        readiness: {
          checks: [{ type: "tcp", port: "rpc" }],
          intervalMs: 5,
        },
        ports: new Map([["rpc", port]]),
        processExited: neverExits,
        timeoutMs: 200,
      });
    } finally {
      await close(server);
    }
  });

  it("requires every configured readiness check", async () => {
    const httpServer = createHttpServer((_request, response) => {
      response.writeHead(HTTP_OK).end("ready");
    });
    const tcpServer = createTcpServer();
    const httpPort = await listen(httpServer);
    const tcpPort = await listen(tcpServer);
    try {
      await waitForServiceReadiness({
        serviceName: "web",
        readiness: {
          checks: [
            { type: "http", port: "http", path: "/health" },
            { type: "tcp", port: "rpc" },
          ],
          intervalMs: 5,
        },
        ports: new Map([
          ["http", httpPort],
          ["rpc", tcpPort],
        ]),
        processExited: neverExits,
        timeoutMs: 200,
      });
    } finally {
      await Promise.all([close(httpServer), close(tcpServer)]);
    }
  });

  it("uses readyTimeoutMs as a hard deadline", async () => {
    const unavailablePort = await allocateUnusedPort();
    const startedAt = Date.now();

    await expect(
      waitForServiceReadiness(
        workerReadiness({
          intervalMs: 5,
          port: unavailablePort,
          processExited: neverExits,
          timeoutMs: 30,
        })
      )
    ).rejects.toThrow('Service "worker" readiness timed out after 30ms');
    expect(Date.now() - startedAt).toBeLessThan(DEADLINE_TEST_CEILING_MS);
  });

  it("fails immediately when the process exits before readiness", async () => {
    await expect(
      waitForServiceReadiness(
        workerReadiness({
          intervalMs: 100,
          port: 1,
          processExited: Promise.resolve(EARLY_EXIT_CODE),
          timeoutMs: 1000,
        })
      )
    ).rejects.toThrow(
      'Service "worker" exited with code 17 before becoming ready'
    );
  });
});

type ClosableServer = {
  address(): ReturnType<ReturnType<typeof createTcpServer>["address"]>;
  listen(port: number, host: string, callback: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  close(callback: (error?: Error) => void): unknown;
};

function listen(server: ClosableServer): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not expose a TCP port"));
        return;
      }
      resolvePort(address.port);
    });
  });
}

function close(server: ClosableServer): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

async function allocateUnusedPort(): Promise<number> {
  const server = createTcpServer();
  const port = await listen(server);
  await close(server);
  return port;
}
