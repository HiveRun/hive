export const HIVE_TOOL_SOURCE = String.raw`import { tool } from "@opencode-ai/plugin";

type HiveService = {
  id: string;
  name: string;
  type: string;
  status: string;
  port?: number;
  url?: string;
  pid?: number;
  command: string;
  cwd: string;
  logPath?: string;
  lastKnownError?: string | null;
  env: Record<string, string>;
  updatedAt: string;
  recentLogs?: string | null;
  processAlive: boolean;
  portReachable?: boolean;
};

type ServiceListResponse = {
  services: HiveService[];
};

type CellResponse = {
  setupLog?: string | null;
  setupLogPath?: string | null;
};

const DEFAULT_PROTOCOL = process.env.SERVICE_PROTOCOL ?? "http";
const DEFAULT_HOST = process.env.SERVICE_HOST ?? "localhost";

function resolveBaseUrl() {
  const port =
    process.env.SERVER_PORT ??
    process.env.PORT ??
    process.env.SERVICE_PORT ??
    "";
  if (!port) {
    return {
      ok: false as const,
      error:
        "Missing SERVER_PORT. Set SERVER_PORT or PORT to reach the Hive API.",
    };
  }
  return {
    ok: true as const,
    baseUrl: \`\${DEFAULT_PROTOCOL}://\${DEFAULT_HOST}:\${port}\`,
  };
}

function resolveCellId(cellId?: string | null) {
  return cellId?.trim() || process.env.HIVE_CELL_ID || "";
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const details = body ? \` \${body}\` : "";
    throw new Error(
      \`Request failed (\${response.status}) for \${url}.\${details}\`
    );
  }
  return (await response.json()) as T;
}

function formatServicesText(
  serviceList: HiveService[],
  includeLogs: boolean
): string {
  if (serviceList.length === 0) {
    return "No services found for this cell.";
  }

  return serviceList
    .map((service) => formatSingleServiceText(service, includeLogs))
    .join("\n\n");
}

function formatSingleServiceText(
  service: HiveService,
  includeLogs: boolean
): string {
  let portReachable: string | null = null;
  if (service.portReachable != null) {
    portReachable = service.portReachable ? "yes" : "no";
  }

  const lines: [string, string | null][] = [
    ["Service", service.name],
    ["Status", service.status],
    ["Type", service.type || null],
    ["Port", service.port != null ? String(service.port) : null],
    ["URL", service.url ?? null],
    ["PID", service.pid != null ? String(service.pid) : null],
    ["Process", service.processAlive ? "running" : "not running"],
    ["Port reachable", portReachable],
    ["Last error", service.lastKnownError ?? null],
  ];

  const output = lines.flatMap(([label, value]) =>
    value ? [\`\${label}: \${value}\`] : []
  );

  if (includeLogs) {
    output.push(\`Recent logs:\n\${service.recentLogs ?? "(no log output yet)"}\`);
  }

  return output.join("\n");
}

export const services = tool({
  description: "List Hive cell services with status, ports, and recent logs.",
  args: {
    cellId: tool.schema.string().optional().describe("Override cell id."),
    includeLogs: tool.schema
      .boolean()
      .optional()
      .describe("Include recent log output for each service."),
    format: tool.schema
      .enum(["text", "json"])
      .optional()
      .describe("Return format for the service list."),
  },
  async execute(args, context) {
    const base = resolveBaseUrl();
    if (!base.ok) {
      return \`Error: \${base.error}\`;
    }

    const cellId = resolveCellId(args.cellId);
    if (!cellId) {
      return "Error: Missing HIVE_CELL_ID. Provide cellId or set HIVE_CELL_ID.";
    }

    const includeLogs = args.includeLogs ?? true;
    const format = args.format ?? "text";

    try {
      const payload = await fetchJson<ServiceListResponse>(
        \`\${base.baseUrl}/api/cells/\${cellId}/services\`,
        context.abort
      );

      if (format === "json") {
        const servicesPayload = includeLogs
          ? payload.services
          : payload.services.map((service) => ({
              ...service,
              recentLogs: undefined,
            }));
        return JSON.stringify({ services: servicesPayload }, null, 2);
      }

      return formatServicesText(payload.services, includeLogs);
    } catch (error) {
      return \`Error: \${error instanceof Error ? error.message : String(error)}\`;
    }
  },
});

export const service_logs = tool({
  description: "Fetch recent log output for a specific Hive cell service.",
  args: {
    serviceName: tool.schema
      .string()
      .describe("Service name (matches the Hive service entry)."),
    cellId: tool.schema.string().optional().describe("Override cell id."),
    format: tool.schema
      .enum(["text", "json"])
      .optional()
      .describe("Return format for the log response."),
  },
  async execute(args, context) {
    const base = resolveBaseUrl();
    if (!base.ok) {
      return \`Error: \${base.error}\`;
    }

    const cellId = resolveCellId(args.cellId);
    if (!cellId) {
      return "Error: Missing HIVE_CELL_ID. Provide cellId or set HIVE_CELL_ID.";
    }

    const format = args.format ?? "text";

    try {
      const payload = await fetchJson<ServiceListResponse>(
        \`\${base.baseUrl}/api/cells/\${cellId}/services\`,
        context.abort
      );

      const match = payload.services.find(
        (service) => service.name === args.serviceName
      );

      if (!match) {
        const names = payload.services.map((service) => service.name).sort();
        return \`Error: Service "\${args.serviceName}" not found. Available: \${names.join(", ")}\`;
      }

      if (format === "json") {
        return JSON.stringify(
          {
            name: match.name,
            status: match.status,
            recentLogs: match.recentLogs ?? "",
            logPath: match.logPath ?? null,
          },
          null,
          2
        );
      }

      return [
        \`Service: \${match.name}\`,
        \`Status: \${match.status}\`,
        \`Log path: \${match.logPath ?? "(unknown)"}\`,
        "Recent logs:",
        match.recentLogs ?? "(no log output yet)",
      ].join("\n");
    } catch (error) {
      return \`Error: \${error instanceof Error ? error.message : String(error)}\`;
    }
  },
});

export const setup_logs = tool({
  description: "Fetch the cell setup log output.",
  args: {
    cellId: tool.schema.string().optional().describe("Override cell id."),
    format: tool.schema
      .enum(["text", "json"])
      .optional()
      .describe("Return format for the setup log."),
  },
  async execute(args, context) {
    const base = resolveBaseUrl();
    if (!base.ok) {
      return \`Error: \${base.error}\`;
    }

    const cellId = resolveCellId(args.cellId);
    if (!cellId) {
      return "Error: Missing HIVE_CELL_ID. Provide cellId or set HIVE_CELL_ID.";
    }

    const format = args.format ?? "text";

    try {
      const payload = await fetchJson<CellResponse>(
        \`\${base.baseUrl}/api/cells/\${cellId}\`,
        context.abort
      );

      if (format === "json") {
        return JSON.stringify(
          {
            setupLog: payload.setupLog ?? "",
            setupLogPath: payload.setupLogPath ?? null,
          },
          null,
          2
        );
      }

      return [
        \`Setup log path: \${payload.setupLogPath ?? "(unknown)"}\`,
        "Setup logs:",
        payload.setupLog ?? "(no setup log output yet)",
      ].join("\n");
    } catch (error) {
      return \`Error: \${error instanceof Error ? error.message : String(error)}\`;
    }
  },
});
`;
