import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { DatabaseService } from "../db";
import type { CellService } from "../schema/services";
import { cellServices } from "../schema/services";
import { safeSync } from "../utils/result";

type DbClient = typeof import("../db").db;

type PortManagerDeps = {
  db: DbClient;
  now: () => Date;
};

const FORCE_KILL_DELAY_MS = 250;

export function createPortManager({ db, now }: PortManagerDeps) {
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

    await db
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
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => {
      server.close(() => resolvePort(false));
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolvePort(true));
    });
  });
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
  const terminateResult = safeSync(
    () => process.kill(pid, "SIGTERM"),
    () => null
  );

  if (terminateResult.isErr()) {
    return;
  }

  await delay(FORCE_KILL_DELAY_MS);

  safeSync(
    () => {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    },
    () => null
  );
}

type PortManagerError = {
  readonly _tag: "PortManagerError";
  readonly cause: unknown;
};

const makePortManagerError = (cause: unknown): PortManagerError => ({
  _tag: "PortManagerError",
  cause,
});

export type PortManagerService = {
  readonly ensureServicePort: (
    service: CellService
  ) => Effect.Effect<number, PortManagerError>;
  readonly rememberSpecificPort: (
    serviceId: string,
    port: number
  ) => Effect.Effect<void>;
  readonly releasePortFor: (serviceId: string) => Effect.Effect<void>;
  readonly findFreePort: () => Effect.Effect<number, PortManagerError>;
};

export const PortManagerService = Context.GenericTag<PortManagerService>(
  "@hive/server/PortManagerService"
);

export const PortManagerLayer = Layer.effect(
  PortManagerService,
  Effect.gen(function* () {
    const { db } = yield* DatabaseService;
    const manager = createPortManager({ db, now: () => new Date() });
    return {
      ensureServicePort: (service) =>
        Effect.tryPromise({
          try: () => manager.ensureServicePort(service),
          catch: (cause) => makePortManagerError(cause),
        }),
      rememberSpecificPort: (serviceId, port) =>
        Effect.sync(() => {
          manager.rememberSpecificPort(serviceId, port);
        }),
      releasePortFor: (serviceId) =>
        Effect.sync(() => {
          manager.releasePortFor(serviceId);
        }),
      findFreePort: () =>
        Effect.tryPromise({
          try: () => manager.findFreePort(),
          catch: (cause) => makePortManagerError(cause),
        }),
    } satisfies PortManagerService;
  })
);
