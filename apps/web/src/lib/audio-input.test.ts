import { describe, expect, it } from "vitest";

import {
  addPreferredAudioInput,
  HIVE_MICROPHONE_STATUS_MESSAGE,
  isHiveMicrophoneStatusMessage,
} from "./audio-input";

describe("addPreferredAudioInput", () => {
  it("adds an encoded preferred microphone without replacing viewer params", () => {
    expect(
      addPreferredAudioInput(
        "http://localhost:41847/?serial=emulator-5580",
        "Monitor of USB Audio"
      )
    ).toBe(
      "http://localhost:41847/?serial=emulator-5580&hiveMicrophone=Monitor+of+USB+Audio"
    );
  });

  it("leaves viewers unchanged when no preference is configured", () => {
    expect(addPreferredAudioInput("http://localhost:41847/", null)).toBe(
      "http://localhost:41847/"
    );
    expect(addPreferredAudioInput(null, "USB Audio")).toBeNull();
  });
});

describe("isHiveMicrophoneStatusMessage", () => {
  it("accepts structured viewer microphone status", () => {
    expect(
      isHiveMicrophoneStatusMessage({
        type: HIVE_MICROPHONE_STATUS_MESSAGE,
        status: "error",
        message: "Requested device not found",
      })
    ).toBe(true);
  });

  it("rejects unrelated or malformed cross-origin messages", () => {
    expect(
      isHiveMicrophoneStatusMessage({ type: "other", status: "error" })
    ).toBe(false);
    expect(
      isHiveMicrophoneStatusMessage({
        type: HIVE_MICROPHONE_STATUS_MESSAGE,
        status: "unknown",
      })
    ).toBe(false);
  });
});
