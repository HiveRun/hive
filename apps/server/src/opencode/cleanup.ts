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

/**
 * Find the PID of the process listening on a specific port
 */
async function findProcessOnPort(port: number): Promise<number | null> {
  try {
    // Try lsof first (more portable)
    const { stdout } = await execAsync(
      `lsof -ti:${port} -sTCP:LISTEN 2>/dev/null || true`
    );
    const pid = stdout.trim();
    return pid ? Number.parseInt(pid, 10) : null;
  } catch {
    // If lsof fails, try fuser as fallback
    try {
      const { stdout } = await execAsync(
        `fuser ${port}/tcp 2>/dev/null || true`
      );
      const pid = stdout.trim();
      return pid ? Number.parseInt(pid, 10) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Kill a process by PID
 */
async function killProcess(pid: number): Promise<boolean> {
  try {
    // Try graceful shutdown first (SIGTERM)
    await execAsync(`kill -TERM ${pid} 2>/dev/null || true`);

    // Wait a bit for graceful shutdown
    await new Promise((resolve) =>
      setTimeout(resolve, GRACEFUL_SHUTDOWN_DELAY_MS)
    );

    // Check if still running, force kill if needed
    try {
      await execAsync(`kill -0 ${pid} 2>/dev/null`);
      // Still running, force kill
      await execAsync(`kill -KILL ${pid} 2>/dev/null || true`);
    } catch {
      // Process already dead (kill -0 failed)
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up orphaned OpenCode server on a specific port
 */
export async function cleanupOrphanedServer(port: number): Promise<boolean> {
  const pid = await findProcessOnPort(port);
  if (!pid) {
    return false; // No process found
  }

  return killProcess(pid);
}

/**
 * Clean up all orphaned OpenCode servers for given ports
 */
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
