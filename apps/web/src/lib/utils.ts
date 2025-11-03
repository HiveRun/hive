import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function extractFromRecord(record: Record<string, unknown>): string | null {
  const nestedKeys: Array<"value" | "error"> = ["value", "error"];
  for (const key of nestedKeys) {
    if (key in record) {
      const nested = extractRpcErrorMessage(record[key]);
      if (nested) {
        return nested;
      }
    }
  }

  const directKeys: Array<"message" | "summary"> = ["message", "summary"];
  for (const key of directKeys) {
    if (key in record) {
      const message = toTrimmedString(record[key]);
      if (message) {
        return message;
      }
    }
  }

  return null;
}

function extractRpcErrorMessage(error: unknown): string | undefined {
  const direct = toTrimmedString(error);
  if (direct) {
    return direct;
  }

  if (!error || typeof error !== "object") {
    return;
  }

  const fromRecord = extractFromRecord(error as Record<string, unknown>);
  if (fromRecord) {
    return fromRecord;
  }

  return;
}

export function unwrapRpcResponse<T>(
  response: unknown,
  fallbackMessage: string
): T {
  const result = response as {
    data: unknown;
    error: unknown;
  };

  if (result.error) {
    const message = extractRpcErrorMessage(result.error);
    throw new Error(message ?? fallbackMessage);
  }

  const data = result.data;

  if (!data) {
    throw new Error(fallbackMessage);
  }

  if (
    typeof data === "object" &&
    "error" in (data as Record<string, unknown>)
  ) {
    const message = extractRpcErrorMessage((data as { error?: unknown }).error);
    throw new Error(message ?? fallbackMessage);
  }

  return data as T;
}
