import { resolvePublicApiBaseUrl } from "../instance/public-url";

const DEFAULT_SERVICE_HOST = process.env.SERVICE_HOST ?? "localhost";
const DEFAULT_SERVICE_PROTOCOL = process.env.SERVICE_PROTOCOL ?? "http";

const trimTrailingSlash = (value: string) =>
  value.endsWith("/") ? value.slice(0, -1) : value;

export const buildServiceRuntimeUrl = (port?: number | null) =>
  typeof port === "number"
    ? `${DEFAULT_SERVICE_PROTOCOL}://${DEFAULT_SERVICE_HOST}:${port}`
    : null;

const buildServiceBrowserUrl = (args: { cellId: string; serviceId: string }) =>
  `${trimTrailingSlash(resolvePublicApiBaseUrl())}/api/cells/${encodeURIComponent(
    args.cellId
  )}/services/${encodeURIComponent(args.serviceId)}/proxy/`;

export const buildServiceUrls = (args: {
  cellId: string;
  serviceId: string;
  port?: number | null;
}) => {
  const runtimeUrl = buildServiceRuntimeUrl(args.port);
  if (!runtimeUrl) {
    return {
      runtimeUrl: null,
      directUrl: null,
      browserUrl: null,
    };
  }

  return {
    runtimeUrl,
    directUrl: runtimeUrl,
    browserUrl: buildServiceBrowserUrl(args),
  };
};
