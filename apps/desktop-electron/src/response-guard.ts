const DESKTOP_READY_HEADER = "x-hive-desktop-ready";

export function resolveProtectedDesktopOrigins(
  rendererUrl: string,
  backendUrl: string
) {
  const backend = new URL(backendUrl);
  const backendWebSocket = new URL(backend);
  backendWebSocket.protocol = backend.protocol === "https:" ? "wss:" : "ws:";
  return new Set([
    new URL(rendererUrl).origin,
    backend.origin,
    backendWebSocket.origin,
  ]);
}

export function hasDesktopReadyToken(
  headers: Record<string, string[]> | undefined,
  expectedToken: string
) {
  if (!headers) {
    return false;
  }

  for (const [name, values] of Object.entries(headers)) {
    if (
      name.toLowerCase() === DESKTOP_READY_HEADER &&
      values.includes(expectedToken)
    ) {
      return true;
    }
  }
  return false;
}
