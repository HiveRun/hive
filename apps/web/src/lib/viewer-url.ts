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
  portReachable: boolean | null;
  primary: boolean;
  protocol: "http" | "https";
  serviceId: string;
  serviceName: string;
  status: string;
  testId: string;
  url: string;
};

type ViewerPortInput = {
  name: string;
  port: number;
  portReachable: boolean;
  primary: boolean;
  protocol: "http" | "https" | "tcp";
  url?: string;
};

type ViewerServiceInput = {
  id: string;
  name: string;
  port?: number;
  portReachable?: boolean;
  ports?: ViewerPortInput[];
  status: string;
  url?: string;
};

type BrowserPort = ViewerPortInput & {
  protocol: "http" | "https";
  url: string;
};

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

export function resolveBrowserViewerAvailability(options: {
  hasService: boolean;
  reachability: boolean | null;
  serviceStatus: string | undefined;
  viewerUrl: string | null;
}): BrowserViewerAvailability {
  if (!options.hasService) {
    return "empty";
  }

  if (!resolveLoopbackHttpViewerUrl(options.viewerUrl)) {
    return "unsupported";
  }

  if (options.serviceStatus?.toLowerCase() !== "running") {
    return "not-running";
  }

  if (options.reachability === false) {
    return "unreachable";
  }

  if (options.reachability === true) {
    return "ready";
  }

  return "checking";
}

export function resolveNativeViewerAvailability(
  target: BrowserViewerTarget | undefined
): BrowserViewerAvailability {
  return resolveBrowserViewerAvailability({
    hasService: Boolean(target),
    reachability: target?.portReachable ?? null,
    serviceStatus: target?.status,
    viewerUrl: target?.url ?? null,
  });
}

export function resolveBrowserViewerTargets(
  services: ViewerServiceInput[]
): BrowserViewerTarget[] {
  return services.flatMap((service): BrowserViewerTarget[] => {
    const namedBrowserPorts = (service.ports ?? []).flatMap(
      (port): BrowserPort[] => {
        if (port.protocol === "tcp") {
          return [];
        }
        const url = port.url ?? (port.primary ? service.url : undefined);
        return url ? [{ ...port, protocol: port.protocol, url }] : [];
      }
    );
    if (namedBrowserPorts.length > 0) {
      return namedBrowserPorts.map((port) => ({
        id: port.primary ? service.id : `${service.id}:${port.name}`,
        label: service.name,
        port: port.port,
        portName: port.name,
        portReachable: port.portReachable,
        primary: port.primary,
        protocol: port.protocol,
        serviceId: service.id,
        serviceName: service.name,
        status: service.status,
        testId:
          port.primary && namedBrowserPorts.length === 1
            ? service.name
            : `${service.name}-${port.name}`,
        url: port.url,
      }));
    }

    if (
      (service.ports?.length ?? 0) > 0 ||
      service.port == null ||
      typeof service.url !== "string"
    ) {
      return [];
    }

    return [
      {
        id: service.id,
        label: service.name,
        port: service.port,
        portName: "default",
        portReachable: service.portReachable ?? null,
        primary: true,
        protocol: resolveHttpProtocol(service.url),
        serviceId: service.id,
        serviceName: service.name,
        status: service.status,
        testId: service.name,
        url: service.url,
      },
    ];
  });
}

function resolveHttpProtocol(value: string): "http" | "https" {
  try {
    return new URL(value).protocol === "https:" ? "https" : "http";
  } catch {
    return "http";
  }
}
