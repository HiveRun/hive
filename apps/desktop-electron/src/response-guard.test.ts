import { expect, test } from "bun:test";
import {
  hasDesktopReadyToken,
  resolveProtectedDesktopOrigins,
} from "./response-guard";

const READY_TOKEN = "launch-token";

test("accepts the desktop readiness token regardless of header casing", () => {
  expect(
    hasDesktopReadyToken({ "X-Hive-Desktop-Ready": [READY_TOKEN] }, READY_TOKEN)
  ).toBe(true);
});

test("rejects missing and unrelated desktop readiness tokens", () => {
  expect(hasDesktopReadyToken(undefined, READY_TOKEN)).toBe(false);
  expect(
    hasDesktopReadyToken(
      { "x-hive-desktop-ready": ["another-launch"] },
      READY_TOKEN
    )
  ).toBe(false);
});

test("protects renderer, API, and backend WebSocket origins", () => {
  expect(
    resolveProtectedDesktopOrigins(
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3000"
    )
  ).toEqual(
    new Set([
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3000",
      "ws://127.0.0.1:3000",
    ])
  );
});
