type RpcErrorPayload = {
  message?: string;
  details?: string;
};

type RpcErrorLike = {
  message?: string;
  value?: unknown;
};

const NEWLINE = "\n\n";

export function formatRpcError(
  error: RpcErrorLike | null | undefined,
  fallbackMessage: string
): string {
  if (!error) {
    return fallbackMessage;
  }

  const payload = extractPayload(error.value);
  if (payload) {
    return formatPayload(payload, fallbackMessage);
  }

  if (error.message && error.message.length > 0) {
    return error.message;
  }

  return fallbackMessage;
}

export function formatRpcResponseError(
  data: unknown,
  fallbackMessage: string
): string {
  const payload = extractPayload(data);
  if (payload) {
    return formatPayload(payload, fallbackMessage);
  }
  return fallbackMessage;
}

function extractPayload(value: unknown): RpcErrorPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const message =
    typeof record.message === "string" ? record.message : undefined;
  const details =
    typeof record.details === "string" ? record.details : undefined;

  if (!(message || details)) {
    return null;
  }

  return { message, details } satisfies RpcErrorPayload;
}

function formatPayload(
  payload: RpcErrorPayload,
  fallbackMessage: string
): string {
  if (payload.message && payload.details) {
    return `${payload.message}${NEWLINE}${payload.details}`;
  }

  if (payload.message) {
    return payload.message;
  }

  if (payload.details) {
    return payload.details;
  }

  return fallbackMessage;
}
