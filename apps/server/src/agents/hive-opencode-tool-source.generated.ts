/**
 * Auto-generated v2 plugin source by scripts/dev/generate-hive-opencode-tool-source.ts
 * Do not edit directly.
 */
export const HIVE_TOOL_SOURCE_EMBEDDED = `import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { Plugin } from "@opencode-ai/plugin";
export const HIVE_PLUGIN_REVISION = "1", HIVE_PLUGIN_CAPABILITIES = [
  "tools",
  "fresh-context",
  "shell-environment",
  "worktree-boundary"
], HIVE_PLUGIN_ID = "hive.cell.v2.r1.tools-context-shell-permission";
const HIVE_CONFIG_RELATIVE_PATH = join(".hive", "config.json"), HIVE_CONTEXT_TIMEOUT_MS = 1e4, HIVE_TOOL_REQUEST_TIMEOUT_MS = 600000, TRAILING_GLOB_PATTERN = /[\\\\/]\\*{1,2}$/u, HIVE_INHERITED_SHELL_ENV_KEYS = [
  "HIVE_CLI_BIN",
  "HIVE_CELL_RUNTIME_DIR",
  "HIVE_CELL_ARTIFACTS_DIR"
];
function buildLogQueryParams(lines, offset) {
  const params = new URLSearchParams;
  if (lines != null)
    params.set("logLines", String(lines));
  if (offset != null)
    params.set("logOffset", String(offset));
  const query = params.toString();
  return query ? \`?\${query}\` : "";
}
function readHiveConfig(worktreePath) {
  const configPath = join(worktreePath, HIVE_CONFIG_RELATIVE_PATH);
  try {
    const content = readFileSync(configPath, "utf-8"), config = JSON.parse(content);
    if (!config.cellId || typeof config.cellId !== "string")
      return Error("Invalid .hive/config.json: missing or invalid cellId. Ensure this worktree was created by Hive.");
    if (!config.hiveUrl || typeof config.hiveUrl !== "string")
      return Error("Invalid .hive/config.json: missing or invalid hiveUrl. Ensure this worktree was created by Hive.");
    return { cellId: config.cellId, hiveUrl: config.hiveUrl };
  } catch (error) {
    if (error.code === "ENOENT")
      return Error(\`Could not find .hive/config.json in \${worktreePath}. This tool must be run from within a Hive cell worktree.\`);
    return Error(\`Failed to read .hive/config.json: \${error instanceof Error ? error.message : String(error)}\`);
  }
}
async function fetchJson(url, signal, init) {
  const requestSignal = signal ?? init?.signal ?? AbortSignal.timeout(HIVE_TOOL_REQUEST_TIMEOUT_MS), response = await fetch(url, { ...init, signal: requestSignal });
  if (!response.ok) {
    const body = await response.text().catch(() => ""), details = body ? \` \${body}\` : "";
    throw Error(\`Request failed (\${response.status}) for \${url}.\${details}\`);
  }
  return await response.json();
}
function buildHiveToolHeaders(toolName, extra) {
  return {
    "x-hive-source": "opencode",
    "x-hive-tool": toolName,
    ...extra ?? {}
  };
}
function formatToolError(error) {
  return \`Error: \${error instanceof Error ? error.message : String(error)}\`;
}
function resolveHiveToolConfig(context) {
  return readHiveConfig(context.worktreePath);
}
function buildServiceStatusOptions(args) {
  return {
    includeLogs: args.includeLogs ?? !1,
    format: args.format ?? "text",
    queryParams: buildLogQueryParams(args.logLines, args.logOffset)
  };
}
function resolveHiveToolRequest(context, args) {
  const config = resolveHiveToolConfig(context);
  if (config instanceof Error)
    return config;
  return { config, format: args.format ?? "text" };
}
function formatServiceListPayload(serviceList, includeLogs) {
  return includeLogs ? serviceList : serviceList.map((service) => removeServiceLogs(service));
}
async function executeWithHiveToolRequest(context, args, action) {
  const request = resolveHiveToolRequest(context, args);
  if (request instanceof Error)
    return formatToolError(request);
  try {
    return await action(request);
  } catch (error) {
    return formatToolError(error);
  }
}
async function fetchAndFormatHiveToolResult(options) {
  const output = await executeWithHiveToolRequest(options.context, options.args, async (request) => {
    const payload = await fetchJson(options.url(request.config), void 0, options.init);
    return options.formatResponse(payload, request.format);
  });
  return toolResult(output);
}
async function fetchAndFormatServiceListToolResult(options) {
  return await fetchAndFormatHiveToolResult({
    ...options,
    url: (config) => cellServicesUrl(config, options.queryParams)
  });
}
const cellServicesUrl = (config, queryParams = "") => \`\${config.hiveUrl}/api/cells/\${encodeURIComponent(config.cellId)}/services\${queryParams}\`, cellUrl = (config, suffix = "") => \`\${config.hiveUrl}/api/cells/\${encodeURIComponent(config.cellId)}\${suffix}\`, stringArg = (description) => ({
  type: "string",
  description
}), numberArg = (description) => ({
  type: "number",
  description
}), booleanArg = (description) => ({
  type: "boolean",
  description
}), outputFormatArg = {
  type: "string",
  enum: ["text", "json"],
  description: "Output format. Use 'json' for programmatic parsing. Default: text."
}, statusIncludeLogsArg = booleanArg("Include recent log output in the final status display. Default: false."), statusLogLinesArg = numberArg("Number of log lines to show in the final status display (1-2000). Default: 200."), statusLogOffsetArg = numberArg("Skip this many lines from the end in the final status display (pagination)."), createConfirmArg = (action) => booleanArg(\`Required. Set true to actually \${action}. This prevents accidental actions.\`), objectInput = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: !1
});
function toolResult(content) {
  return {
    content,
    metadata: {
      plugin: HIVE_PLUGIN_ID,
      revision: HIVE_PLUGIN_REVISION
    }
  };
}
async function executeServiceRestart(args) {
  const config = resolveHiveToolConfig(args.context);
  if (config instanceof Error)
    return formatToolError(config);
  const { includeLogs, format, queryParams } = buildServiceStatusOptions(args.serviceArgs);
  try {
    await args.restart(config);
    const final = await fetchJson(cellServicesUrl(config, queryParams), void 0);
    if (format === "json") {
      const servicesPayload = formatServiceListPayload(final.services, includeLogs);
      return JSON.stringify({
        restarted: args.restarted,
        services: servicesPayload
      }, null, 2);
    }
    return [
      args.title,
      "",
      formatServicesText(final.services, includeLogs)
    ].join(\`
\`);
  } catch (error) {
    return formatToolError(error);
  }
}
async function restartAllCellServices(args) {
  await fetchJson(cellServicesUrl(args.config, "/restart"), args.signal, { method: "POST", headers: args.headers });
}
async function resolveServiceIdByName(args) {
  const list = await fetchJson(cellServicesUrl(args.config), args.signal), match = list.services.find((service) => service.name === args.serviceName);
  if (!match) {
    const names = list.services.map((service) => service.name).sort();
    throw Error(\`Service "\${args.serviceName}" not found. Available: \${names.join(", ")}\`);
  }
  return match.id;
}
async function restartSingleService(args) {
  const serviceId = await resolveServiceIdByName(args);
  await fetchJson(cellServicesUrl(args.config, \`/\${encodeURIComponent(serviceId)}/restart\`), args.signal, { method: "POST", headers: args.headers });
}
function removeServiceLogs(service) {
  return { ...service, recentLogs: void 0 };
}
function formatRestartTitle(serviceName) {
  return serviceName ? \`Restarted service: \${serviceName}\` : "Restarted all services.";
}
function formatServicesText(serviceList, includeLogs) {
  if (serviceList.length === 0)
    return "No services found for this cell.";
  return serviceList.map((service) => formatSingleServiceText(service, includeLogs)).join(\`

\`);
}
function formatPortReachable(value) {
  if (value == null)
    return null;
  return value ? "yes" : "no";
}
function formatNumber(value) {
  if (value == null)
    return null;
  return String(value);
}
function formatLogHeader(service) {
  if (service.totalLogLines == null)
    return "Recent logs:";
  const moreText = service.hasMoreLogs ? ", more available" : "";
  return \`Recent logs (\${service.totalLogLines} total lines\${moreText}):\`;
}
function formatServiceLogHeader(service) {
  if (service.totalLogLines == null)
    return "Recent logs:";
  const moreText = service.hasMoreLogs ? ", more available with logOffset" : "";
  return \`Recent logs (\${service.totalLogLines} total lines\${moreText}):\`;
}
function formatServiceLogsText(service) {
  return [
    \`Service: \${service.name}\`,
    \`Status: \${service.status}\`,
    \`Log path: \${service.logPath ?? "(unknown)"}\`,
    formatServiceLogHeader(service),
    service.recentLogs ?? "(no log output yet)"
  ].join(\`
\`);
}
function formatSingleServiceText(service, includeLogs) {
  const output = [
    ["Service", service.name],
    ["Status", service.status],
    ["Type", service.type || null],
    ["Port", formatNumber(service.port)],
    ["URL", service.url ?? null],
    ["PID", formatNumber(service.pid)],
    ["Process", service.processAlive ? "running" : "not running"],
    ["Port reachable", formatPortReachable(service.portReachable)],
    ["Last error", service.lastKnownError ?? null]
  ].flatMap(([label, value]) => value ? [\`\${label}: \${value}\`] : []);
  if (includeLogs) {
    const logHeader = formatLogHeader(service);
    output.push(\`\${logHeader}
\${service.recentLogs ?? "(no log output yet)"}\`);
  }
  return output.join(\`
\`);
}
function createServicesTool(context) {
  return {
    name: "hive_services",
    options: { codemode: !1 },
    description: \`Check the status of all services (backend, frontend, database, etc.) running in this cell.

USE THIS TOOL WHEN:
- You need to debug why something isn't working (check if services are running)
- You want to see error messages or stack traces from service logs
- You need to find which port a service is running on
- You want to check if a service crashed or restarted

RETURNS: For each service: name, status (running/stopped/error), port, URL, process info, and recent log output.

PAGINATION: By default returns last 200 log lines per service. Use logLines/logOffset to get more or paginate through history.\`,
    input: objectInput({
      includeLogs: booleanArg("Include recent log output for each service. Set to false for a quick status check without logs. Default: true."),
      logLines: numberArg("Number of log lines to return per service (1-2000). Use higher values to see more history. Default: 200."),
      logOffset: numberArg("Skip this many lines from the end. Use with logLines to paginate: offset=0 gets newest, offset=200 gets the 200 lines before that."),
      format: outputFormatArg
    }),
    async execute(input) {
      const args = input, includeLogs = args.includeLogs ?? !0, queryParams = buildLogQueryParams(args.logLines, args.logOffset);
      return await fetchAndFormatServiceListToolResult({
        context,
        args,
        queryParams,
        formatResponse: (payload, format) => {
          if (format === "json") {
            const servicesPayload = formatServiceListPayload(payload.services, includeLogs);
            return JSON.stringify({ services: servicesPayload }, null, 2);
          }
          return formatServicesText(payload.services, includeLogs);
        }
      });
    }
  };
}
function createServiceLogsTool(context) {
  return {
    name: "hive_service_logs",
    options: { codemode: !1 },
    description: \`Get log output for a specific service by name.

USE THIS TOOL WHEN:
- You already know which service has the problem and want to focus on its logs
- You need more log history than hive_services provides
- You want to paginate through a service's log history to find when an error started

EXAMPLE: If hive_services shows "web" service has status "error", use this to get more detailed logs.

TIP: If you don't know the service name, call hive_services first to see available services.\`,
    input: objectInput({
      serviceName: stringArg("The service name to get logs for. Must match exactly (e.g., 'web', 'api', 'db'). Call hive_services first if unsure of available names."),
      logLines: numberArg("Number of log lines to return (1-2000). Use higher values like 500-1000 to see more context around errors. Default: 200."),
      logOffset: numberArg("Skip this many lines from the end to see older logs. Example: logOffset=200, logLines=200 returns lines 201-400 from the end."),
      format: outputFormatArg
    }, ["serviceName"]),
    async execute(input) {
      const args = input, queryParams = buildLogQueryParams(args.logLines, args.logOffset), headers = buildHiveToolHeaders("hive_service_logs", {
        "x-hive-audit-event": "service.logs.read",
        "x-hive-service-name": args.serviceName
      });
      return await fetchAndFormatServiceListToolResult({
        context,
        args,
        queryParams,
        formatResponse: (payload, format) => {
          const match = payload.services.find((service) => service.name === args.serviceName);
          if (!match) {
            const names = payload.services.map((service) => service.name).sort();
            return \`Error: Service "\${args.serviceName}" not found. Available: \${names.join(", ")}\`;
          }
          if (format === "json")
            return JSON.stringify({
              name: match.name,
              status: match.status,
              recentLogs: match.recentLogs ?? "",
              logPath: match.logPath ?? null,
              totalLogLines: match.totalLogLines ?? null,
              hasMoreLogs: match.hasMoreLogs ?? !1
            }, null, 2);
          return formatServiceLogsText(match);
        },
        init: { method: "GET", headers }
      });
    }
  };
}
function createSetupLogsTool(context) {
  return {
    name: "hive_setup_logs",
    options: { codemode: !1 },
    description: \`Get logs from the cell's initial setup/provisioning phase.

USE THIS TOOL WHEN:
- The cell failed during initial setup (before services started)
- You need to debug dependency installation issues (npm install, pip install, etc.)
- You want to see what commands ran during cell initialization
- Services won't start and you suspect a setup problem

WHAT THIS SHOWS: Output from setup commands defined in the template (e.g., package installation, database migrations, build steps) that ran when the cell was first created.

NOTE: This is different from service logs - setup runs once when the cell is created, services run continuously after.\`,
    input: objectInput({ format: outputFormatArg }),
    async execute(input) {
      const args = input, headers = buildHiveToolHeaders("hive_setup_logs", {
        "x-hive-audit-event": "setup.logs.read"
      });
      return await fetchAndFormatHiveToolResult({
        context,
        args,
        url: (config) => cellUrl(config),
        formatResponse: (payload, format) => {
          if (format === "json")
            return JSON.stringify({
              setupLog: payload.setupLog ?? "",
              setupLogPath: payload.setupLogPath ?? null
            }, null, 2);
          return [
            \`Setup log path: \${payload.setupLogPath ?? "(unknown)"}\`,
            "Setup logs:",
            payload.setupLog ?? "(no setup log output yet)"
          ].join(\`
\`);
        },
        init: { method: "GET", headers }
      });
    }
  };
}
function createRestartServicesTool(context) {
  return {
    name: "hive_restart_services",
    options: { codemode: !1 },
    description: \`Restart ALL services for this cell.

THIS IS A DESTRUCTIVE OPERATION:
- Stops services and starts them again
- Interrupts any in-flight requests

USE THIS TOOL WHEN:
- You need a full clean restart of the cell (e.g., after broad config changes)

IF YOU ONLY NEED ONE SERVICE: use hive_restart_service instead.

SAFETY: You must pass confirm=true or the tool will refuse to run.

TIP: Call hive_services after restarting to confirm everything is healthy.\`,
    input: objectInput({
      includeLogs: statusIncludeLogsArg,
      logLines: statusLogLinesArg,
      logOffset: statusLogOffsetArg,
      format: outputFormatArg,
      confirm: createConfirmArg("restart services")
    }),
    async execute(input) {
      const args = input;
      if (args.confirm !== !0)
        return toolResult("Refusing to restart services without confirm=true.");
      const headers = buildHiveToolHeaders("hive_restart_services"), output = await executeServiceRestart({
        context,
        serviceArgs: args,
        restarted: "all",
        title: formatRestartTitle(),
        restart: (config) => restartAllCellServices({ config, headers })
      });
      return toolResult(output);
    }
  };
}
function createRestartServiceTool(context) {
  return {
    name: "hive_restart_service",
    options: { codemode: !1 },
    description: \`Restart a SINGLE service for this cell.

THIS IS A DESTRUCTIVE OPERATION:
- Stops the service and starts it again
- Interrupts any in-flight requests to that service

USE THIS TOOL WHEN:
- One service is wedged/crashed and you want minimal blast radius

SAFETY: You must pass confirm=true or the tool will refuse to run.

TIP: Call hive_services after restarting to confirm everything is healthy.\`,
    input: objectInput({
      serviceName: stringArg("The service name to restart (exact match). Call hive_services first if unsure of available names."),
      includeLogs: statusIncludeLogsArg,
      logLines: statusLogLinesArg,
      logOffset: statusLogOffsetArg,
      format: outputFormatArg,
      confirm: createConfirmArg("restart the service")
    }, ["serviceName"]),
    async execute(input) {
      const args = input;
      if (args.confirm !== !0)
        return toolResult("Refusing to restart a service without confirm=true.");
      const headers = buildHiveToolHeaders("hive_restart_service"), output = await executeServiceRestart({
        context,
        serviceArgs: args,
        restarted: args.serviceName,
        title: formatRestartTitle(args.serviceName),
        restart: (config) => restartSingleService({
          config,
          serviceName: args.serviceName,
          headers
        })
      });
      return toolResult(output);
    }
  };
}
function createRerunSetupTool(context) {
  return {
    name: "hive_rerun_setup",
    options: { codemode: !1 },
    description: \`Re-run cell setup/provisioning.

This re-executes the template setup commands (dependency installs, migrations, etc.) and re-ensures services.

USE THIS TOOL WHEN:
- The cell failed provisioning and needs a retry after fixing the workspace
- Dependencies or migrations are out of date and you want to re-run setup

SAFETY: You must pass confirm=true or the tool will refuse to run.\`,
    input: objectInput({
      format: outputFormatArg,
      confirm: createConfirmArg("rerun setup")
    }),
    async execute(input) {
      const args = input;
      if (args.confirm !== !0)
        return toolResult("Refusing to rerun setup without confirm=true.");
      const headers = buildHiveToolHeaders("hive_rerun_setup");
      return await fetchAndFormatHiveToolResult({
        context,
        args,
        url: (config) => cellUrl(config, "/setup/retry"),
        formatResponse: (payload, format) => {
          if (format === "json")
            return JSON.stringify(payload, null, 2);
          const status = typeof payload.status === "string" ? payload.status : "(unknown)", setupLogPath = typeof payload.setupLogPath === "string" ? payload.setupLogPath : "(unknown)", setupLog = typeof payload.setupLog === "string" ? payload.setupLog : null;
          return [
            \`Setup rerun requested. Current cell status: \${status}\`,
            \`Setup log path: \${setupLogPath}\`,
            "Setup logs:",
            setupLog ?? "(no setup log output yet)"
          ].join(\`
\`);
        },
        init: { method: "POST", headers }
      });
    }
  };
}
export function createHiveTools(worktreePath) {
  const context = { worktreePath };
  return [
    createServicesTool(context),
    createServiceLogsTool(context),
    createSetupLogsTool(context),
    createRestartServicesTool(context),
    createRestartServiceTool(context),
    createRerunSetupTool(context)
  ];
}
function canonicalizePath(path) {
  let current = resolve(path);
  const missingSegments = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current)
      break;
    missingSegments.unshift(basename(current));
    current = parent;
  }
  return resolve(realpathSync(current), ...missingSegments);
}
function isWithin(root, target) {
  try {
    const path = relative(canonicalizePath(root), canonicalizePath(target));
    return path === "" || !isAbsolute(path) && path !== ".." && !path.startsWith(\`..\${sep}\`);
  } catch {
    return !1;
  }
}
function validateCellLocation(config, cell, worktreePath) {
  if (cell.id !== config.cellId)
    throw Error(\`Hive cell identity mismatch: expected \${config.cellId}, received \${cell.id}.\`);
  if (resolve(cell.workspacePath) !== resolve(worktreePath))
    throw Error(\`Hive cell worktree mismatch: expected \${resolve(worktreePath)}, received \${resolve(cell.workspacePath)}.\`);
}
function buildHealthRevision(cell, services) {
  const state = JSON.stringify({
    cell: {
      id: cell.id,
      status: cell.status,
      workspacePath: cell.workspacePath
    },
    services: services.map((service) => ({
      id: service.id,
      status: service.status,
      updatedAt: service.updatedAt,
      ports: service.ports?.map((port) => ({
        name: port.name,
        port: port.port,
        primary: port.primary,
        portReachable: port.portReachable
      }))
    })).sort((left, right) => left.id.localeCompare(right.id))
  });
  return createHash("sha256").update(state).digest("hex");
}
async function loadHiveHealth(worktreePath, signal) {
  const config = readHiveConfig(worktreePath);
  if (config instanceof Error)
    throw config;
  const [cell, serviceList] = await Promise.all([
    fetchJson(cellUrl(config, "?includeSetupLog=false"), signal, {
      headers: buildHiveToolHeaders("hive_plugin_context")
    }),
    fetchJson(cellServicesUrl(config, "?logLines=1"), signal, { headers: buildHiveToolHeaders("hive_plugin_context") })
  ]);
  validateCellLocation(config, cell, worktreePath);
  return {
    config,
    cell,
    services: serviceList.services,
    revision: buildHealthRevision(cell, serviceList.services)
  };
}
function formatHiveContext(health, worktreePath) {
  const services = health.services.length ? health.services.map((service) => {
    const ports = (service.ports ?? []).map((port) => \`\${port.name}=\${port.port}\`).join(", ");
    return \`- \${service.name}: \${service.status}\${ports ? \` (\${ports})\` : ""}\`;
  }).join(\`
\`) : "- No services registered.";
  return [
    "# Fresh Hive Cell Context",
    \`- Plugin: \${HIVE_PLUGIN_ID}\`,
    \`- Plugin revision: \${HIVE_PLUGIN_REVISION}\`,
    \`- Cell: \${health.cell.name} (\${health.cell.id})\`,
    \`- Cell status: \${health.cell.status}\`,
    \`- Worktree: \${worktreePath}\`,
    \`- Health revision: \${health.revision}\`,
    "- Keep all mutations and shell working directories inside this worktree.",
    "- Configured references may be read, but must not be modified.",
    "## Current Services",
    services
  ].join(\`
\`);
}
function sanitizeEnvironmentName(value) {
  return value.replace(/[^a-zA-Z0-9]/gu, "_").toUpperCase();
}
function buildPortEnvironment(services) {
  const environment = {};
  for (const service of services) {
    const serviceKey = sanitizeEnvironmentName(service.name), ports = service.ports ?? [];
    for (const port of ports) {
      const value = String(port.port);
      environment[\`\${serviceKey}_\${sanitizeEnvironmentName(port.name)}_PORT\`] = value;
      if (port.primary)
        environment[\`\${serviceKey}_PORT\`] = value;
    }
    if (ports.length === 0 && service.port != null)
      environment[\`\${serviceKey}_PORT\`] = String(service.port);
  }
  return environment;
}
function buildCellEnvironment(worktreePath, config, services) {
  const inheritedCellId = process.env.HIVE_CELL_ID;
  if (inheritedCellId && inheritedCellId !== config.cellId)
    throw Error(\`Hive shell cell identity mismatch: expected \${config.cellId}, inherited \${inheritedCellId}.\`);
  const environment = {
    HIVE_CELL_ID: config.cellId,
    HIVE_BROWSE_ROOT: worktreePath,
    HIVE_HOME: join(worktreePath, ".hive", "home"),
    SERVICE_HOST: process.env.SERVICE_HOST ?? "localhost",
    SERVICE_PROTOCOL: process.env.SERVICE_PROTOCOL ?? "http"
  };
  for (const key of HIVE_INHERITED_SHELL_ENV_KEYS) {
    const serviceValues = new Set(services.map((service) => service.env[key]).filter((candidate) => Boolean(candidate)));
    if (serviceValues.size > 1)
      throw Error(\`Hive services disagree on the cell environment \${key}.\`);
    const value = serviceValues.values().next().value ?? process.env[key];
    if (value)
      environment[key] = value;
  }
  return environment;
}
async function loadReferenceRoots(context) {
  try {
    return (await context.reference.list()).data.map((reference) => resolve(reference.path));
  } catch {
    return [];
  }
}
function permissionResourcePath(root, resource) {
  const withoutGlob = resource.replace(TRAILING_GLOB_PATTERN, "");
  return resolve(root, withoutGlob);
}
function denyPermission(event, message) {
  event.effect = "deny";
  event.message = message;
}
const HIVE_MUTATION_ACTIONS = new Set([
  "edit",
  "write",
  "patch",
  "apply_patch"
]);
async function setupHivePlugin(context) {
  const worktreePath = resolve(context.location.project.directory), configPath = join(worktreePath, HIVE_CONFIG_RELATIVE_PATH);
  if (!existsSync(configPath))
    return;
  const config = readHiveConfig(worktreePath);
  if (config instanceof Error)
    throw config;
  const tools = createHiveTools(worktreePath);
  await context.tool.transform((draft) => {
    for (const definition of tools)
      draft.add(definition);
  });
  await context.session.hook("context", async (event) => {
    const missingTools = tools.map((tool) => tool.name).filter((name) => !event.tools[name]);
    if (missingTools.length > 0)
      throw Error(\`Hive plugin capability validation failed; missing tools: \${missingTools.join(", ")}\`);
    const health = await loadHiveHealth(worktreePath, AbortSignal.timeout(HIVE_CONTEXT_TIMEOUT_MS));
    event.system.push({
      type: "text",
      text: formatHiveContext(health, worktreePath),
      metadata: {
        hive: {
          pluginId: HIVE_PLUGIN_ID,
          pluginRevision: HIVE_PLUGIN_REVISION,
          capabilities: [...HIVE_PLUGIN_CAPABILITIES],
          cellId: health.cell.id,
          cellStatus: health.cell.status,
          healthRevision: health.revision,
          ready: !0
        }
      }
    });
  });
  await context.shell.hook("create.before", async (event) => {
    if (!isWithin(worktreePath, event.cwd))
      throw Error(\`Hive shell working directory is outside the cell worktree: \${event.cwd}\`);
    const health = await loadHiveHealth(worktreePath, AbortSignal.timeout(HIVE_CONTEXT_TIMEOUT_MS));
    Object.assign(event.env, buildCellEnvironment(worktreePath, health.config, health.services), buildPortEnvironment(health.services));
  });
  await context.permission.hook("evaluate", async (event) => {
    if (event.action === "external_directory") {
      const referenceRoots = await loadReferenceRoots(context), allowedRoots = [worktreePath, ...referenceRoots], blocked = event.resources.find((resource) => {
        const target = permissionResourcePath(worktreePath, resource);
        return !allowedRoots.some((root) => isWithin(root, target));
      });
      if (blocked)
        denyPermission(event, \`Hive denied access outside the cell worktree and configured references: \${blocked}\`);
      return;
    }
    if (!HIVE_MUTATION_ACTIONS.has(event.action))
      return;
    const blocked = event.resources.find((resource) => !isWithin(worktreePath, permissionResourcePath(worktreePath, resource)));
    if (blocked)
      denyPermission(event, \`Hive denied mutation outside the cell worktree: \${blocked}\`);
  });
}
export default Plugin.define({
  id: HIVE_PLUGIN_ID,
  setup: setupHivePlugin
});
`;
