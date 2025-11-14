import { afterEach, describe, expect, it } from "vitest";

import { hasTauriBridge } from "./debug-notifications";

type TauriGlobal = typeof import("@tauri-apps/api");

const getWindow = () => {
  const globalRef = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis;
  };
  if (!globalRef.window) {
    globalRef.window = {} as Window & typeof globalThis;
  }
  return globalRef.window;
};

afterEach(() => {
  const win = getWindow();
  win.__TAURI__ = undefined;
  win.__TAURI_IPC__ = undefined;
});

describe("hasTauriBridge", () => {
  it("returns false when no tauri globals exist", () => {
    expect(hasTauriBridge()).toBe(false);
  });

  it("returns true when __TAURI__ exists", () => {
    const win = getWindow();
    win.__TAURI__ = {} as TauriGlobal;
    expect(hasTauriBridge()).toBe(true);
  });

  it("returns true when legacy __TAURI_IPC__ exists", () => {
    const win = getWindow();
    win.__TAURI_IPC__ = () => null;
    expect(hasTauriBridge()).toBe(true);
  });
});
