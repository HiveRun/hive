import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { ServiceStatus } from "../schema/services";

const execAsync = promisify(exec);
const GRACEFUL_SHUTDOWN_DELAY_MS = 1000;
const RESTARTABLE_STATUSES: ReadonlySet<ServiceStatus> = new Set([
  "pending",
  "starting",
  "running",
  "needs_resume",
]);

type ServiceProcessRecord = {
  id: string;
  pid: number | null;
  port: number | null;
  status: ServiceStatus;
};

type CleanupResult = {
  updatedServiceIds: string[];
  cleanedPids: number[];
  failedPids: number[];
};

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findProcessOnPort(port: number): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `lsof -ti:${port} -sTCP:LISTEN 2>/dev/null || true`
    );
    const pid = stdout.trim();
    return pid ? Number.parseInt(pid, 10) : null;
  } catch {
    return null;
  }
}

async function killProcess(pid: number): Promise<boolean> {
  try {
    await execAsync(`kill -TERM ${pid} 2>/dev/null || true`);
    await new Promise((resolve) =>
      setTimeout(resolve, GRACEFUL_SHUTDOWN_DELAY_MS)
    );

    try {
      await execAsync(`kill -0 ${pid} 2>/dev/null`);
      await execAsync(`kill -KILL ${pid} 2>/dev/null || true`);
    } catch {
      return true;
    }

    return true;
  } catch {
    return false;
  }
}

type PortCleanupResult = {
  cleanedPid?: number;
  failedPid?: number;
};

async function cleanupServicePort(
  port: number | null
): Promise<PortCleanupResult> {
  if (typeof port !== "number") {
    return {};
  }

  const portPid = await findProcessOnPort(port);
  if (typeof portPid !== "number") {
    return {};
  }

  const success = await killProcess(portPid);
  if (success) {
    return { cleanedPid: portPid };
  }

  return { failedPid: portPid };
}

function shouldUpdateService(
  status: ServiceStatus,
  pidAlive: boolean
): boolean {
  if (!RESTARTABLE_STATUSES.has(status)) {
    return false;
  }

  return !pidAlive;
}

export async function cleanupOrphanedServiceProcesses(
  services: ServiceProcessRecord[]
): Promise<CleanupResult> {
  const updated = new Set<string>();
  const cleanedPids: number[] = [];
  const failedPids: number[] = [];

  for (const service of services) {
    const pidAlive =
      typeof service.pid === "number" && isProcessAlive(service.pid);
    if (pidAlive) {
      continue;
    }

    const { cleanedPid, failedPid } = await cleanupServicePort(service.port);
    if (typeof cleanedPid === "number") {
      cleanedPids.push(cleanedPid);
    }
    if (typeof failedPid === "number") {
      failedPids.push(failedPid);
    }

    if (shouldUpdateService(service.status, pidAlive)) {
      updated.add(service.id);
    }
  }

  return {
    updatedServiceIds: Array.from(updated),
    cleanedPids,
    failedPids,
  };
}
