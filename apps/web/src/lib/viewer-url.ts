import type { CellServiceSummary } from "@/queries/cells";

export type BrowserViewerAvailability =
  | "checking"
  | "empty"
  | "not-running"
  | "ready"
  | "unreachable"
  | "unsupported";

export type BrowserViewerTarget = {
  id: string;
  label: string;
  port: number;
  portName: string;
  portReachable: boolean;
  protocol: "http" | "https";
  status: string;
  testId: string;
  url: string;
};

type ViewerService = Pick<
  CellServiceSummary,
  "id" | "name" | "ports" | "status" | "url"
>;

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolveLoopbackHttpViewerUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !LOOPBACK_HOSTNAMES.has(url.hostname) ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function resolveViewerAvailability(
  target: BrowserViewerTarget | undefined,
  reachability: boolean | null = target?.portReachable ?? null
): BrowserViewerAvailability {
  if (!target) {
    return "empty";
  }

  if (!resolveLoopbackHttpViewerUrl(target.url)) {
    return "unsupported";
  }

  if (target.status.toLowerCase() !== "running") {
    return "not-running";
  }

  if (reachability === false) {
    return "unreachable";
  }

  if (reachability === true) {
    return "ready";
  }

  return "checking";
}

export function resolveBrowserViewerTargets(
  services: ViewerService[]
): BrowserViewerTarget[] {
  return services.flatMap((service): BrowserViewerTarget[] => {
    const namedBrowserPorts = service.ports.flatMap((port) => {
      if (port.protocol === "tcp" || !port.viewer) {
        return [];
      }
      const url = port.url ?? (port.primary ? service.url : undefined);
      return url ? [{ ...port, protocol: port.protocol, url }] : [];
    });

    return namedBrowserPorts.map((port) => ({
      id: port.primary ? service.id : `${service.id}:${port.name}`,
      label: service.name,
      port: port.port,
      portName: port.name,
      portReachable: port.portReachable,
      protocol: port.protocol,
      status: service.status,
      testId:
        port.primary && namedBrowserPorts.length === 1
          ? service.name
          : `${service.name}-${port.name}`,
      url: port.url,
    }));
  });
}
