export const DEFAULT_SERVICE_PORT_NAME = "default";
export const DEFAULT_READINESS_INTERVAL_MS = 100;
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
const RESERVED_GENERATED_ENVIRONMENT_KEYS = new Map([
  ["SERVICE_PORT", 'built-in alias "SERVICE_PORT"'],
]);

type PortDefinition = {
  primary?: boolean;
  protocol?: "http" | "https" | "tcp";
};

type ServiceDefinition = {
  type: string;
  dependsOn?: string[];
  ports?: Record<string, PortDefinition>;
  readiness?: { checks: Array<{ port: string }> };
};

export type NamedPortDefinition = {
  name: string;
  primary: boolean;
  protocol: "http" | "https" | "tcp";
};

type ServiceGraphIssue = {
  message: string;
  path: Array<string | number>;
};

export function sanitizeServiceEnvironmentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

export function resolveNamedPortDefinitions(
  definition: Pick<ServiceDefinition, "ports">
): NamedPortDefinition[] {
  const entries = Object.entries(definition.ports ?? {});
  if (entries.length === 0) {
    return [
      { name: DEFAULT_SERVICE_PORT_NAME, primary: true, protocol: "http" },
    ];
  }

  const configuredPrimary = entries.find(([, port]) => port.primary)?.[0];
  const primaryName = configuredPrimary ?? entries[0]?.[0];

  return entries.map(([name, portDefinition]) => ({
    name,
    primary: name === primaryName,
    protocol: portDefinition.protocol ?? "http",
  }));
}

export function resolveServicePortProtocol(
  definition: Pick<ServiceDefinition, "ports">,
  portName: string,
  legacyProtocol: "http" | "https"
): "http" | "https" | "tcp" {
  if (!definition.ports) {
    return legacyProtocol;
  }

  return (
    resolveNamedPortDefinitions(definition).find(
      (port) => port.name === portName
    )?.protocol ?? "http"
  );
}

export function collectServiceGraphIssues(
  services: Record<string, ServiceDefinition>
): ServiceGraphIssue[] {
  const issues = [
    ...collectServiceNameIssues(services),
    ...collectGeneratedEnvironmentKeyIssues(services),
    ...Object.entries(services).flatMap(([serviceName, definition]) => [
      ...collectPortDefinitionIssues(serviceName, definition),
      ...collectDependencyIssues(serviceName, definition, services),
      ...collectReadinessIssues(serviceName, definition),
    ]),
  ];

  if (issues.length === 0) {
    try {
      topologicallySortServiceNames(services);
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        path: ["services"],
      });
    }
  }

  return issues;
}

function collectGeneratedEnvironmentKeyIssues(
  services: Record<string, ServiceDefinition>
): ServiceGraphIssue[] {
  const owners = new Map<string, { label: string; path: string[] }>();
  const issues: ServiceGraphIssue[] = [];

  for (const [key, label] of RESERVED_GENERATED_ENVIRONMENT_KEYS) {
    owners.set(key, { label, path: ["services"] });
  }

  const register = (key: string, label: string, path: string[]) => {
    const existing = owners.get(key);
    if (existing) {
      issues.push({
        message: `Generated environment key "${key}" collides between ${existing.label} and ${label}`,
        path,
      });
      return;
    }
    owners.set(key, { label, path });
  };

  for (const [serviceName, definition] of Object.entries(services)) {
    if (definition.type !== "process") {
      continue;
    }
    const serviceKey = sanitizeServiceEnvironmentName(serviceName);
    register(`${serviceKey}_PORT`, `service "${serviceName}" primary port`, [
      "services",
      serviceName,
    ]);
    for (const port of resolveNamedPortDefinitions(definition)) {
      register(
        `${serviceKey}_${sanitizeServiceEnvironmentName(port.name)}_PORT`,
        `service "${serviceName}" port "${port.name}"`,
        ["services", serviceName, "ports", port.name]
      );
    }
  }

  return issues;
}

function collectServiceNameIssues(
  services: Record<string, ServiceDefinition>
): ServiceGraphIssue[] {
  const seen = new Map<string, string>();
  const issues: ServiceGraphIssue[] = [];
  for (const serviceName of Object.keys(services)) {
    const environmentName = sanitizeServiceEnvironmentName(serviceName);
    const existing = seen.get(environmentName);
    if (existing) {
      issues.push({
        message: `Service names "${existing}" and "${serviceName}" produce the same environment prefix "${environmentName}"`,
        path: ["services", serviceName],
      });
    } else {
      seen.set(environmentName, serviceName);
    }
  }
  return issues;
}

function collectPortDefinitionIssues(
  serviceName: string,
  definition: ServiceDefinition
): ServiceGraphIssue[] {
  if (definition.type !== "process" || !definition.ports) {
    return [];
  }
  const ports = Object.entries(definition.ports);
  const path = ["services", serviceName, "ports"];
  const issues: ServiceGraphIssue[] = [];
  if (ports.length === 0) {
    issues.push({
      message: `Service "${serviceName}" ports must define at least one named port`,
      path,
    });
  }
  if (ports.filter(([, port]) => port.primary === true).length !== 1) {
    issues.push({
      message: `Service "${serviceName}" ports must mark exactly one port as primary`,
      path,
    });
  }
  const seenEnvironmentNames = new Map<string, string>();
  for (const [portName] of ports) {
    const environmentName = sanitizeServiceEnvironmentName(portName);
    const existing = seenEnvironmentNames.get(environmentName);
    if (existing) {
      issues.push({
        message: `Service "${serviceName}" port names "${existing}" and "${portName}" produce the same environment key "${environmentName}"`,
        path: [...path, portName],
      });
    } else {
      seenEnvironmentNames.set(environmentName, portName);
    }
  }
  return issues;
}

function collectDependencyIssues(
  serviceName: string,
  definition: ServiceDefinition,
  services: Record<string, ServiceDefinition>
): ServiceGraphIssue[] {
  return (definition.dependsOn ?? []).flatMap((dependency, index) => {
    if (dependency === serviceName) {
      return [
        {
          message: `Service "${serviceName}" cannot depend on itself`,
          path: ["services", serviceName, "dependsOn", index],
        },
      ];
    }
    if (!(dependency in services)) {
      return [
        {
          message: `Service "${serviceName}" depends on unknown service "${dependency}"`,
          path: ["services", serviceName, "dependsOn", index],
        },
      ];
    }
    return [];
  });
}

function collectReadinessIssues(
  serviceName: string,
  definition: ServiceDefinition
): ServiceGraphIssue[] {
  if (definition.type !== "process" || !definition.readiness) {
    return [];
  }
  const portNames = new Set(
    resolveNamedPortDefinitions(definition).map((port) => port.name)
  );
  return definition.readiness.checks.flatMap((check, index) =>
    portNames.has(check.port)
      ? []
      : [
          {
            message: `Service "${serviceName}" readiness references unknown port "${check.port}"`,
            path: [
              "services",
              serviceName,
              "readiness",
              "checks",
              index,
              "port",
            ],
          },
        ]
  );
}

export function topologicallySortServiceNames(
  services: Record<string, Pick<ServiceDefinition, "dependsOn">>
): string[] {
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  const visit = (serviceName: string) => {
    if (visited.has(serviceName)) {
      return;
    }
    if (visiting.has(serviceName)) {
      const cycleStart = path.indexOf(serviceName);
      const cycle = [...path.slice(cycleStart), serviceName];
      throw new Error(`Service dependency cycle: ${cycle.join(" -> ")}`);
    }

    const definition = services[serviceName];
    if (!definition) {
      throw new Error(`Unknown service "${serviceName}"`);
    }

    visiting.add(serviceName);
    path.push(serviceName);
    for (const dependency of definition.dependsOn ?? []) {
      if (!(dependency in services)) {
        throw new Error(
          `Service "${serviceName}" depends on unknown service "${dependency}"`
        );
      }
      visit(dependency);
    }
    path.pop();
    visiting.delete(serviceName);
    visited.add(serviceName);
    ordered.push(serviceName);
  };

  for (const serviceName of Object.keys(services)) {
    visit(serviceName);
  }

  return ordered;
}

export function getServiceDependencyClosure(
  services: Record<string, Pick<ServiceDefinition, "dependsOn">>,
  serviceName: string
): string[] {
  const required = new Set<string>();
  const collect = (name: string) => {
    if (required.has(name)) {
      return;
    }
    const definition = services[name];
    if (!definition) {
      throw new Error(`Unknown service "${name}"`);
    }
    required.add(name);
    for (const dependency of definition.dependsOn ?? []) {
      collect(dependency);
    }
  };

  collect(serviceName);
  return topologicallySortServiceNames(services).filter((name) =>
    required.has(name)
  );
}
