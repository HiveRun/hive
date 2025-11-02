import type { PortRequest } from "@synthetic/config";

/**
 * Port allocation result
 */
export type AllocatedPort = {
  name: string;
  port: number;
  preferred: boolean; // Whether we got the preferred port
};

/**
 * Check if a port is available on the host
 *
 * Note: This is a best-effort check. In production, services will fail
 * to start if the port is actually in use, at which point we can retry
 * with a different port.
 */
async function isPortAvailable(port: number): Promise<boolean> {
  // Skip check in test environment where Bun runtime might not be fully available
  if (typeof Bun === "undefined" || !Bun.listen) {
    return true;
  }

  try {
    const server = Bun.listen({
      hostname: "localhost",
      port,
      socket: {
        data() {},
        open() {},
        close() {},
        drain() {},
        error() {},
      },
    });

    server.stop();
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
      errorMessage.includes("EADDRINUSE") ||
      errorMessage.includes("address already in use")
    ) {
      return false;
    }
    return false;
  }
}

/**
 * Find an available port starting from a given port
 */
async function findAvailablePort(
  startPort: number,
  maxAttempts = 100
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (port > 65_535) {
      throw new Error("No available ports found");
    }

    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(
    `Could not find available port after ${maxAttempts} attempts`
  );
}

// Track the last allocated port to ensure we don't allocate duplicates
let lastAllocatedPort = 50_000;

/**
 * Allocate ports for services based on requests
 */
export async function allocatePorts(
  requests: PortRequest[]
): Promise<AllocatedPort[]> {
  const allocated: AllocatedPort[] = [];
  const usedPorts = new Set<number>();

  for (const request of requests) {
    let port: number;
    let preferred = false;

    // Try preferred port first if specified
    if (request.preferred && !usedPorts.has(request.preferred)) {
      const available = await isPortAvailable(request.preferred);
      if (available) {
        port = request.preferred;
        preferred = true;
      } else {
        // Preferred port not available, find next available
        port = await findAvailablePort(request.preferred);
      }
    } else {
      // No preferred port, start from last allocated + 1 to avoid duplicates
      const startPort = Math.max(50_000, lastAllocatedPort + 1);
      port = await findAvailablePort(startPort);
      lastAllocatedPort = port;
    }

    usedPorts.add(port);
    allocated.push({
      name: request.name,
      port,
      preferred,
    });
  }

  return allocated;
}

/**
 * Create environment variables from allocated ports
 */
export function createPortEnv(
  allocations: AllocatedPort[],
  requests: PortRequest[]
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const allocation of allocations) {
    const request = requests.find((r) => r.name === allocation.name);
    if (request?.env) {
      env[request.env] = allocation.port.toString();
    }
  }

  return env;
}
