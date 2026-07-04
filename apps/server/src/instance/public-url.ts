const DEFAULT_SERVER_PORT = "3000";
const DEFAULT_HOSTNAME = "localhost";

const trimTrailingSlash = (value: string) =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const LOCAL_HOST_REWRITES = new Map([
  ["0.0.0.0", "127.0.0.1"],
  ["::", "[::1]"],
]);

const formatHostForUrl = (hostname: string) => {
  const rewritten = LOCAL_HOST_REWRITES.get(hostname);
  if (rewritten) {
    return rewritten;
  }

  return hostname.includes(":") ? `[${hostname}]` : hostname;
};

export const resolvePublicApiBaseUrl = () => {
  const configured =
    process.env.HIVE_PUBLIC_API_URL?.trim() ||
    process.env.PUBLIC_API_URL?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  const hostname = process.env.HOST ?? process.env.HOSTNAME ?? DEFAULT_HOSTNAME;
  const port = process.env.PORT ?? DEFAULT_SERVER_PORT;
  return `http://${formatHostForUrl(hostname)}:${port}`;
};

export const resolvePublicWebBaseUrl = () => {
  const configured =
    process.env.HIVE_PUBLIC_WEB_URL?.trim() ||
    process.env.PUBLIC_WEB_URL?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  return resolvePublicApiBaseUrl();
};
