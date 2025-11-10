import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const GRACEFUL_SHUTDOWN_DELAY_MS = 1000;

/**
 * Cleanup orphaned OpenCode server processes
 *
 * This handles cases where processes weren't cleaned up properly:
 * - Server crashed before shutdown handlers ran
 * - Process killed with SIGKILL (kill -9)
 * - System crash or power loss
 * - Developer killed process from terminal during development
 *
 * On startup, we query the database for all known OpenCode ports,
 * then kill any processes still listening on those ports.
 */

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
      // Process already terminated
    }

    return true;
  } catch {
    return false;
  }
}

export async function cleanupOrphanedServer(port: number): Promise<boolean> {
  const pid = await findProcessOnPort(port);
  if (!pid) {
    return false;
  }

  return killProcess(pid);
}

export async function cleanupOrphanedServers(
  ports: number[]
): Promise<{ cleaned: number[]; failed: number[] }> {
  const cleaned: number[] = [];
  const failed: number[] = [];

  for (const port of ports) {
    const success = await cleanupOrphanedServer(port);
    if (success) {
      cleaned.push(port);
    } else {
      const pid = await findProcessOnPort(port);
      if (pid) {
        failed.push(port);
      }
    }
  }

  return { cleaned, failed };
}
