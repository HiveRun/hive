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

export type ServiceInfo = {
  command: string;
  cwd?: string;
  env: Record<string, string>;
  ports: Record<string, number>;
};
