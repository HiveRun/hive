import { getApiBase } from "@/lib/api-base";

export async function fetchControllerJson<T>(
  path: string,
  fallbackMessage: string
): Promise<T> {
  const response = await fetch(new URL(path, getApiBase()).toString());
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = readControllerErrorMessage(payload) ?? fallbackMessage;

    throw new Error(message);
  }

  return payload as T;
}

function readControllerErrorMessage(payload: unknown): string | null {
  if (!(payload && typeof payload === "object")) {
    return null;
  }

  if ("message" in payload && typeof payload.message === "string") {
    return payload.message;
  }

  if (
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }

  return null;
}
