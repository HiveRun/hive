import { useSyncExternalStore } from "react";

import { storage } from "@/lib/storage";

const AUDIO_INPUT_STORAGE_KEY = "hive.audio-input.v1";
const AUDIO_INPUT_CHANGE_EVENT = "hive:audio-input-change";
export const HIVE_MICROPHONE_STATUS_MESSAGE = "hive:microphone-status";

type HiveMicrophoneStatusMessage = {
  type: typeof HIVE_MICROPHONE_STATUS_MESSAGE;
  status: "error" | "ready";
  message?: string;
};

const readPreferredAudioInput = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return storage.get<string>(AUDIO_INPUT_STORAGE_KEY);
};

const subscribeToPreferredAudioInput = (listener: () => void) => {
  if (typeof window === "undefined") {
    return () => {
      // There is no browser subscription during server rendering.
    };
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUDIO_INPUT_STORAGE_KEY) {
      listener();
    }
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(AUDIO_INPUT_CHANGE_EVENT, listener);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(AUDIO_INPUT_CHANGE_EVENT, listener);
  };
};

export function usePreferredAudioInput() {
  return useSyncExternalStore(
    subscribeToPreferredAudioInput,
    readPreferredAudioInput,
    () => null
  );
}

export function setPreferredAudioInput(label: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (label) {
    storage.set(AUDIO_INPUT_STORAGE_KEY, label);
  } else {
    storage.remove(AUDIO_INPUT_STORAGE_KEY);
  }
  window.dispatchEvent(new Event(AUDIO_INPUT_CHANGE_EVENT));
}

export function addPreferredAudioInput(
  value: string | null,
  preferredAudioInput: string | null
) {
  if (!(value && preferredAudioInput)) {
    return value;
  }

  const url = new URL(value);
  url.searchParams.set("hiveMicrophone", preferredAudioInput);
  return url.href;
}

export function isHiveMicrophoneStatusMessage(
  value: unknown
): value is HiveMicrophoneStatusMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<HiveMicrophoneStatusMessage>;
  return (
    message.type === HIVE_MICROPHONE_STATUS_MESSAGE &&
    (message.status === "error" || message.status === "ready") &&
    (message.message === undefined || typeof message.message === "string")
  );
}
