import { createServer } from "node:net";
import type { NamedPortDefinition } from "../config/service-graph";
import {
  DEFAULT_SERVICE_PORT_NAME,
  resolveNamedPortDefinitions,
} from "../config/service-graph";
import type { CellService } from "../schema/services";
import { createServiceRepository } from "./repository";

type DbClient = typeof import("../db").db;

type PortManagerDeps = {
  db: DbClient;
  now: () => Date;
};

export type ServicePortAllocation = {
  primaryName: string;
  ports: Map<string, number>;
};

export function createPortManager({ db: database, now }: PortManagerDeps) {
  const repository = createServiceRepository(database, now);
  const servicePortMap = new Map<string, ServicePortAllocation>();
  const reservedPorts = new Set<number>();
  const persistedPortOwners = new Map<number, string>();
  let persistedClaimsLoaded = false;
  let allocationQueue = Promise.resolve();

  async function loadPersistedClaims(force = false) {
    if (persistedClaimsLoaded && !force) {
      return;
    }
    persistedPortOwners.clear();
    for (const claim of await repository.fetchAllPorts()) {
      persistedPortOwners.set(claim.port, claim.serviceId);
    }
    persistedClaimsLoaded = true;
  }

  function rememberServicePorts(
    serviceId: string,
    allocation: ServicePortAllocation
  ) {
    releasePortFor(serviceId);
    const ports = new Map(allocation.ports);
    servicePortMap.set(serviceId, {
      primaryName: allocation.primaryName,
      ports,
    });
    for (const port of ports.values()) {
      reservedPorts.add(port);
      persistedPortOwners.set(port, serviceId);
    }
  }

  function rememberSpecificPort(serviceId: string, port: number) {
    rememberServicePorts(serviceId, {
      primaryName: DEFAULT_SERVICE_PORT_NAME,
      ports: new Map([[DEFAULT_SERVICE_PORT_NAME, port]]),
    });
  }

  function releasePortFor(serviceId: string) {
    const allocation = servicePortMap.get(serviceId);
    if (!allocation) {
      return;
    }
    for (const port of allocation.ports.values()) {
      reservedPorts.delete(port);
    }
    servicePortMap.delete(serviceId);
  }

  function getServicePorts(
    serviceId: string
  ): ServicePortAllocation | undefined {
    const allocation = servicePortMap.get(serviceId);
    return allocation
      ? {
          primaryName: allocation.primaryName,
          ports: new Map(allocation.ports),
        }
      : undefined;
  }

  async function ensureServicePorts(
    service: CellService,
    definitions: NamedPortDefinition[]
  ): Promise<ServicePortAllocation> {
    return await runWithAllocationLock(async () => {
      await loadPersistedClaims(true);
      return await ensureServicePortsUnlocked(service, definitions);
    });
  }

  async function ensureServicePortsUnlocked(
    service: CellService,
    definitions: NamedPortDefinition[]
  ): Promise<ServicePortAllocation> {
    const persisted = await repository.fetchPortsForService(service.id);
    const persistedByName = new Map(
      persisted.map((claim) => [claim.name, claim.port])
    );
    const primaryName =
      definitions.find((definition) => definition.primary)?.name ??
      definitions[0]?.name;
    if (!primaryName) {
      throw new Error(`Service "${service.name}" has no port definitions`);
    }

    releasePortFor(service.id);
    const allocated = new Map<string, number>();
    for (const definition of definitions) {
      const port = await allocateDefinitionPort({
        allocated,
        definition,
        persistedByName,
        primaryName,
        service,
      });
      allocated.set(definition.name, port);
    }

    const primaryPort = allocated.get(primaryName);
    if (primaryPort == null) {
      throw new Error(
        `Service "${service.name}" has no allocated primary port`
      );
    }

    await repository.reconcileServicePorts({
      serviceId: service.id,
      primaryPort,
      ports: definitions.map((definition) => ({
        name: definition.name,
        port: requireAllocatedPort(service.name, allocated, definition.name),
        primary: definition.name === primaryName,
      })),
    });

    for (const [port, owner] of persistedPortOwners) {
      if (owner === service.id) {
        persistedPortOwners.delete(port);
      }
    }
    const allocation = { primaryName, ports: allocated };
    rememberServicePorts(service.id, allocation);
    service.port = primaryPort;
    return getServicePorts(service.id) ?? allocation;
  }

  async function ensureServicePort(service: CellService): Promise<number> {
    const definitions =
      service.definition.type === "process"
        ? resolveNamedPortDefinitions(service.definition)
        : [
            {
              name: DEFAULT_SERVICE_PORT_NAME,
              primary: true,
              protocol: "http" as const,
            },
          ];
    const allocation = await ensureServicePorts(service, definitions);
    const port = allocation.ports.get(allocation.primaryName);
    if (port == null) {
      throw new Error(`Service "${service.name}" has no primary port`);
    }
    return port;
  }

  async function canReusePort(port: number, service: CellService) {
    const owner = persistedPortOwners.get(port);
    if (owner && owner !== service.id) {
      return false;
    }
    if (reservedPorts.has(port)) {
      return false;
    }
    if (service.pid && isPidAlive(service.pid)) {
      return true;
    }
    return await isPortFree(port);
  }

  async function allocateDefinitionPort(args: {
    allocated: Map<string, number>;
    definition: NamedPortDefinition;
    persistedByName: Map<string, number>;
    primaryName: string;
    service: CellService;
  }): Promise<number> {
    const candidate =
      args.persistedByName.get(args.definition.name) ??
      (args.definition.name === args.primaryName
        ? (args.service.port ?? undefined)
        : undefined);
    if (
      candidate != null &&
      !allocatedHasPort(args.allocated, candidate) &&
      (await canReusePort(candidate, args.service))
    ) {
      return candidate;
    }
    return findFreePortUnlocked(new Set(args.allocated.values()));
  }

  async function findFreePort(): Promise<number> {
    return await runWithAllocationLock(async () => {
      await loadPersistedClaims(true);
      return await findFreePortUnlocked();
    });
  }

  async function findFreePortUnlocked(excluded = new Set<number>()) {
    while (true) {
      const candidate = await allocatePort();
      if (
        !(
          excluded.has(candidate) ||
          reservedPorts.has(candidate) ||
          persistedPortOwners.has(candidate)
        )
      ) {
        return candidate;
      }
    }
  }

  async function runWithAllocationLock<T>(operation: () => Promise<T>) {
    const previous = allocationQueue;
    let release: (() => void) | undefined;
    allocationQueue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  return {
    ensureServicePort,
    ensureServicePorts,
    rememberSpecificPort,
    rememberServicePorts,
    releasePortFor,
    getServicePorts,
    findFreePort,
  };
}

function allocatedHasPort(ports: Map<string, number>, target: number) {
  for (const port of ports.values()) {
    if (port === target) {
      return true;
    }
  }
  return false;
}

function requireAllocatedPort(
  serviceName: string,
  ports: Map<string, number>,
  portName: string
) {
  const port = ports.get(portName);
  if (port == null) {
    throw new Error(
      `Service "${serviceName}" port "${portName}" was not allocated`
    );
  }
  return port;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isPortFree(port: number): Promise<boolean> {
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
          server.close(() => resolvePort(true));
          return;
        }
        server.close(() => resolvePort(false));
      });
      server.listen(port, host, () => {
        server.close(() => resolvePort(true));
      });
    });

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
