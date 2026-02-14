import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { db } from "../db";
import type { CellService } from "../schema/services";
import { cellServices } from "../schema/services";

type DbClient = typeof import("../db").db;

type PortManagerDeps = {
  db: DbClient;
  now: () => Date;
};

const FORCE_KILL_DELAY_MS = 250;

export function createPortManager({ db: database, now }: PortManagerDeps) {
  const servicePortMap = new Map<string, number>();
  const reservedPorts = new Set<number>();

  function rememberSpecificPort(serviceId: string, port: number) {
    servicePortMap.set(serviceId, port);
    reservedPorts.add(port);
  }

  function releasePortFor(serviceId: string) {
    const port = servicePortMap.get(serviceId);
    if (typeof port === "number") {
      reservedPorts.delete(port);
      servicePortMap.delete(serviceId);
    }
  }

  async function ensureServicePort(service: CellService): Promise<number> {
    const existing = service.port ?? servicePortMap.get(service.id);

    if (typeof existing === "number") {
      const available = await ensurePortAvailable(existing, service.pid);
      if (available) {
        rememberSpecificPort(service.id, existing);
        return existing;
      }

      releasePortFor(service.id);
    }

    const port = await findFreePort();
    rememberSpecificPort(service.id, port);

    await database
      .update(cellServices)
      .set({ port, updatedAt: now() })
      .where(eq(cellServices.id, service.id));

    return port;
  }

  async function findFreePort(): Promise<number> {
    while (true) {
      const candidate = await allocatePort();
      if (!reservedPorts.has(candidate)) {
        return candidate;
      }
    }
  }

  async function ensurePortAvailable(
    port: number,
    pid: number | null
  ): Promise<boolean> {
    const available = await isPortFree(port);
    if (available) {
      return true;
    }

    if (pid) {
      await terminatePid(pid);
      return isPortFree(port);
    }

    return false;
  }

  return {
    ensureServicePort,
    rememberSpecificPort,
    releasePortFor,
    findFreePort,
  };
}

function isPortFree(port: number): Promise<boolean> {
  const supportsIpv6 = (code: string | undefined) =>
    code !== "EADDRNOTAVAIL" &&
    code !== "EAFNOSUPPORT" &&
    code !== "EPROTONOSUPPORT";

  const probeHost = (host: string): Promise<boolean> =>
    new Promise((resolvePort) => {
      const server = createServer();
      server.once("error", (error) => {
        const code = (error as NodeJS.ErrnoException).code;
        if (host === "::1" && !supportsIpv6(code)) {
          // IPv6 loopback isn't available on this host; don't block allocation.
          server.close(() => resolvePort(true));
          return;
        }
        server.close(() => resolvePort(false));
      });
      server.listen(port, host, () => {
        server.close(() => resolvePort(true));
      });
    });

  // Ensure the port isn't already claimed on either loopback family.
  return Promise.all([probeHost("127.0.0.1"), probeHost("::1")]).then(
    (results) => results.every(Boolean)
  );
}

function allocatePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", (error) => {
      server.close(() => rejectPort(error));
    });
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolvePort(port));
      } else {
        server.close(() => resolvePort(0));
      }
    });
  });
}

async function terminatePid(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  await delay(FORCE_KILL_DELAY_MS);

  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    /* ignore cleanup errors */
  }
}

export type PortManagerService = {
  readonly ensureServicePort: (service: CellService) => Promise<number>;
  readonly rememberSpecificPort: (serviceId: string, port: number) => void;
  readonly releasePortFor: (serviceId: string) => void;
  readonly findFreePort: () => Promise<number>;
};

export const portManager: PortManagerService = createPortManager({
  db,
  now: () => new Date(),
});

export const PortManagerService = portManager;
