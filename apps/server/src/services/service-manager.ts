import { type ChildProcess, exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { type BetterSQLite3Database, schema } from "../db";

const execAsync = promisify(exec);
const WHITESPACE_REGEX = /\s+/;

type ServiceRecord = typeof schema.services.$inferSelect;

export type ServiceConfig = {
  id: string;
  constructId: string;
  serviceName: string;
  serviceType?: "process" | "docker" | "compose";
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  ports?: Record<string, number>;
  volumes?: Record<string, string>;
};

export type ServiceStatus = {
  id: string;
  serviceName: string;
  serviceType: string;
  status: "running" | "stopped" | "needs_resume" | "error";
  pid?: number;
  containerId?: string;
  command?: string;
  cwd?: string;
  env?: Record<string, string>;
  ports?: Record<string, number>;
  volumes?: Record<string, string>;
  healthStatus: "healthy" | "unhealthy" | "unknown";
  lastHealthCheck?: number;
  cpuUsage?: string;
  memoryUsage?: string;
  diskUsage?: string;
  errorMessage?: string;
  startedAt?: number;
  stoppedAt?: number;
};

const runningProcesses = new Map<string, ChildProcess>();

export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    await execAsync(`kill -0 ${pid}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get process resource usage
 */
export async function getProcessUsage(pid: number): Promise<{
  cpuUsage: string;
  memoryUsage: string;
}> {
  try {
    // Get CPU and memory usage from ps
    const { stdout } = await execAsync(
      `ps -p ${pid} -o %cpu,%mem --no-headers`
    );
    const [cpu, memory] = stdout.trim().split(WHITESPACE_REGEX);
    return {
      cpuUsage: `${cpu}%`,
      memoryUsage: `${memory}%`,
    };
  } catch {
    return {
      cpuUsage: "0%",
      memoryUsage: "0%",
    };
  }
}

/**
 * Start a service process
 */
export async function startService(
  db: BetterSQLite3Database,
  config: ServiceConfig
): Promise<void> {
  const { id, command, cwd, env = {}, ports = {}, volumes = {} } = config;

  // Check if service is already running
  const existingService = await db.query.services.findFirst({
    where: eq(schema.services.id, id),
  });

  if (existingService?.status === "running" && existingService.pid) {
    const isRunning = await isProcessRunning(existingService.pid);
    if (isRunning) {
      throw new Error(`Service ${config.serviceName} is already running`);
    }
  }

  // Prepare environment variables
  const processEnv = { ...process.env, ...env };

  // Add port environment variables
  for (const [name, port] of Object.entries(ports)) {
    processEnv[name] = port.toString();
  }

  // Start the process
  const child = spawn(command, [], {
    shell: true,
    cwd: cwd || process.cwd(),
    env: processEnv,
    detached: true,
    stdio: "ignore",
  });

  // Don't wait for the child process
  child.unref();

  if (!child.pid) {
    throw new Error(
      `Failed to start service ${config.serviceName}: No PID assigned`
    );
  }

  // Store the process reference
  runningProcesses.set(id, child);

  // Update database with service information
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(schema.services)
    .values({
      id,
      constructId: config.constructId,
      serviceName: config.serviceName,
      serviceType: config.serviceType || "process",
      status: "running",
      pid: child.pid,
      command,
      cwd,
      env,
      ports,
      volumes,
      healthStatus: "unknown",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.services.id,
      set: {
        status: "running",
        pid: child.pid,
        command,
        cwd,
        env,
        ports,
        volumes,
        healthStatus: "unknown",
        updatedAt: now,
        startedAt: now,
        stoppedAt: null,
        errorMessage: null,
      },
    });

  // Set up process exit handler
  child.on("exit", (code, _signal) => {
    runningProcesses.delete(id);

    // Update database when process exits
    db.update(schema.services)
      .set({
        status: "stopped",
        updatedAt: Math.floor(Date.now() / 1000),
        stoppedAt: Math.floor(Date.now() / 1000),
        errorMessage: code !== 0 ? `Process exited with code ${code}` : null,
      })
      .where(eq(schema.services.id, id))
      .catch(() => {
        // Ignore database update errors in exit handler
      });
  });
}

/**
 * Stop a service process
 */
export async function stopService(
  db: BetterSQLite3Database,
  serviceId: string
): Promise<void> {
  const service = await db.query.services.findFirst({
    where: eq(schema.services.id, serviceId),
  });

  if (!service) {
    throw new Error(`Service not found: ${serviceId}`);
  }

  if (service.status !== "running" || !service.pid) {
    // Service is already stopped
    return;
  }

  try {
    // Try graceful shutdown first
    await execAsync(`kill -TERM ${service.pid}`);

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if process is still running
    const isRunning = await isProcessRunning(service.pid);
    if (isRunning) {
      // Force kill if still running
      await execAsync(`kill -KILL ${service.pid}`);
    }
  } catch {
    // Process may not exist, ignore error
  }

  // Remove from running processes
  runningProcesses.delete(serviceId);

  // Update database
  const now = Math.floor(Date.now() / 1000);
  await db
    .update(schema.services)
    .set({
      status: "stopped",
      updatedAt: now,
      stoppedAt: now,
    })
    .where(eq(schema.services.id, serviceId));
}

/**
 * Restart a service
 */
export async function restartService(
  db: BetterSQLite3Database,
  serviceId: string
): Promise<void> {
  const service = await db.query.services.findFirst({
    where: eq(schema.services.id, serviceId),
  });

  if (!service) {
    throw new Error(`Service not found: ${serviceId}`);
  }

  // Stop the service if running
  if (service.status === "running") {
    await stopService(db, serviceId);
  }

  // Start the service again
  if (service.command) {
    await startService(db, {
      id: service.id,
      constructId: service.constructId,
      serviceName: service.serviceName,
      serviceType:
        (service.serviceType as "process" | "docker" | "compose") || "process",
      command: service.command,
      cwd: service.cwd || undefined,
      env: (service.env as Record<string, string>) || {},
      ports: (service.ports as Record<string, number>) || {},
      volumes: (service.volumes as Record<string, string>) || {},
    });
  }
}

/**
 * Check process health and update status if needed
 */
async function checkProcessHealth(
  db: BetterSQLite3Database,
  service: ServiceRecord,
  serviceId: string
): Promise<{
  actualStatus: string;
  healthStatus: string;
  cpuUsage?: string;
  memoryUsage?: string;
}> {
  let actualStatus: "running" | "stopped" | "needs_resume" | "error" =
    service.status as "running" | "stopped" | "needs_resume" | "error";
  let healthStatus: "healthy" | "unhealthy" | "unknown" =
    (service.healthStatus as "healthy" | "unhealthy" | "unknown") || "unknown";
  let cpuUsage: string | undefined;
  let memoryUsage: string | undefined;

  if (service.status === "running" && service.pid) {
    const isRunning = await isProcessRunning(service.pid);
    if (isRunning) {
      const usage = await getProcessUsage(service.pid);
      cpuUsage = usage.cpuUsage;
      memoryUsage = usage.memoryUsage;
      healthStatus = "healthy";
    } else {
      actualStatus = "needs_resume";
      healthStatus = "unhealthy";

      await db
        .update(schema.services)
        .set({
          status: "needs_resume",
          healthStatus: "unhealthy",
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(schema.services.id, serviceId));
    }
  }

  return { actualStatus, healthStatus, cpuUsage, memoryUsage };
}

/**
 * Build service status response
 */
function buildServiceStatusResponse(
  service: ServiceRecord,
  healthInfo: {
    actualStatus: string;
    healthStatus: string;
    cpuUsage?: string;
    memoryUsage?: string;
  }
): ServiceStatus {
  return {
    id: service.id,
    serviceName: service.serviceName,
    serviceType: service.serviceType,
    status: healthInfo.actualStatus as
      | "running"
      | "stopped"
      | "needs_resume"
      | "error",
    pid: service.pid || undefined,
    containerId: service.containerId || undefined,
    command: service.command || undefined,
    cwd: service.cwd || undefined,
    env: (service.env as Record<string, string>) || undefined,
    ports: (service.ports as Record<string, number>) || undefined,
    volumes: (service.volumes as Record<string, string>) || undefined,
    healthStatus: healthInfo.healthStatus as
      | "healthy"
      | "unhealthy"
      | "unknown",
    lastHealthCheck: service.lastHealthCheck || undefined,
    cpuUsage: healthInfo.cpuUsage,
    memoryUsage: healthInfo.memoryUsage,
    diskUsage: service.diskUsage || undefined,
    errorMessage: service.errorMessage || undefined,
    startedAt: service.startedAt || undefined,
    stoppedAt: service.stoppedAt || undefined,
  };
}

/**
 * Get service status with real-time information
 */
export async function getServiceStatus(
  db: BetterSQLite3Database,
  serviceId: string
): Promise<ServiceStatus | null> {
  const service = await db.query.services.findFirst({
    where: eq(schema.services.id, serviceId),
  });

  if (!service) {
    return null;
  }

  const healthInfo = await checkProcessHealth(db, service, serviceId);
  return buildServiceStatusResponse(service, healthInfo);
}

/**
 * Get all services for a construct with real-time status
 */
export async function getConstructServices(
  db: BetterSQLite3Database,
  constructId: string
): Promise<ServiceStatus[]> {
  const services = await db.query.services.findMany({
    where: eq(schema.services.constructId, constructId),
  });

  const statuses: ServiceStatus[] = [];

  for (const service of services) {
    const status = await getServiceStatus(db, service.id);
    if (status) {
      statuses.push(status);
    }
  }

  return statuses;
}

/**
 * Check all services and update their status
 * This should be called periodically to maintain accurate service state
 */
export async function checkAllServices(
  db: BetterSQLite3Database
): Promise<void> {
  const services = await db.query.services.findMany();

  for (const service of services) {
    if (service.status === "running" && service.pid) {
      const isRunning = await isProcessRunning(service.pid);
      const now = Math.floor(Date.now() / 1000);

      if (isRunning) {
        // Update health status and resource usage
        const usage = await getProcessUsage(service.pid);
        await db
          .update(schema.services)
          .set({
            healthStatus: "healthy",
            lastHealthCheck: now,
            cpuUsage: usage.cpuUsage,
            memoryUsage: usage.memoryUsage,
            updatedAt: now,
          })
          .where(eq(schema.services.id, service.id));
      } else {
        // Process died, mark as needs_resume
        await db
          .update(schema.services)
          .set({
            status: "needs_resume",
            healthStatus: "unhealthy",
            updatedAt: now,
          })
          .where(eq(schema.services.id, service.id));
      }
    }
  }
}

/**
 * Get the exact command and environment used to start a service
 * Useful for users who want to run the command manually
 */
export async function getServiceInfo(
  db: BetterSQLite3Database,
  serviceId: string
): Promise<{
  command: string;
  cwd?: string;
  env: Record<string, string>;
  ports: Record<string, number>;
}> {
  const service = await db.query.services.findFirst({
    where: eq(schema.services.id, serviceId),
  });

  if (!service) {
    throw new Error(`Service not found: ${serviceId}`);
  }

  return {
    command: service.command || "",
    cwd: service.cwd || undefined,
    env: (service.env as Record<string, string>) || {},
    ports: (service.ports as Record<string, number>) || {},
  };
}
