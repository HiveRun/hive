import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { ProcessService } from "../config/schema";
import {
  DEFAULT_READINESS_INTERVAL_MS,
  DEFAULT_READY_TIMEOUT_MS,
} from "../config/service-graph";

type Readiness = NonNullable<ProcessService["readiness"]>;
type ReadinessCheck = Readiness["checks"][number];

type WaitForServiceReadinessArgs = {
  serviceName: string;
  readiness: Readiness;
  ports: ReadonlyMap<string, number>;
  processExited: Promise<number>;
  timeoutMs?: number;
};

export async function waitForServiceReadiness({
  serviceName,
  readiness,
  ports,
  processExited,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
}: WaitForServiceReadinessArgs): Promise<void> {
  for (const check of readiness.checks) {
    if (!ports.has(check.port)) {
      throw new Error(
        `Service "${serviceName}" readiness port "${check.port}" is not allocated`
      );
    }
  }

  const deadline = Date.now() + timeoutMs;
  const intervalMs = readiness.intervalMs ?? DEFAULT_READINESS_INTERVAL_MS;
  const exited = processExited.then((exitCode) => ({
    type: "exit" as const,
    exitCode,
  }));

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(
        `Service "${serviceName}" readiness timed out after ${timeoutMs}ms`
      );
    }

    const result = await Promise.race([
      probeReadinessChecks(readiness.checks, ports, remainingMs).then(
        (ready) => ({
          type: "probe" as const,
          ready,
        })
      ),
      exited,
    ]);
    if (result.type === "exit") {
      throw new Error(
        `Service "${serviceName}" exited with code ${result.exitCode} before becoming ready`
      );
    }
    if (result.ready) {
      return;
    }

    const waitMs = Math.min(intervalMs, deadline - Date.now());
    if (waitMs <= 0) {
      continue;
    }
    const waitResult = await Promise.race([
      delay(waitMs).then(() => ({ type: "delay" as const })),
      exited,
    ]);
    if (waitResult.type === "exit") {
      throw new Error(
        `Service "${serviceName}" exited with code ${waitResult.exitCode} before becoming ready`
      );
    }
  }
}

async function probeReadinessChecks(
  checks: ReadinessCheck[],
  ports: ReadonlyMap<string, number>,
  timeoutMs: number
): Promise<boolean> {
  const results = await Promise.all(
    checks.map((check) => {
      const port = ports.get(check.port);
      if (port == null) {
        return false;
      }
      if (check.type === "tcp") {
        return probeTcp(check.host ?? "127.0.0.1", port, timeoutMs);
      }
      return probeHttp({
        host: check.host ?? "127.0.0.1",
        method: check.method ?? "GET",
        path: check.path ?? "/",
        port,
        protocol: check.protocol ?? "http",
        timeoutMs,
      });
    })
  );
  return results.every(Boolean);
}

function probeTcp(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolveProbe(ready);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function probeHttp(args: {
  host: string;
  method: "GET" | "HEAD";
  path: string;
  port: number;
  protocol: "http" | "https";
  timeoutMs: number;
}): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    const response = await fetch(
      `${args.protocol}://${args.host}:${args.port}${args.path}`,
      { method: args.method, redirect: "follow", signal: controller.signal }
    );
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
