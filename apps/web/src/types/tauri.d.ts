type TauriGlobal = typeof import("@tauri-apps/api");

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: must extend DOM Window interface
  interface Window {
    __TAURI__?: TauriGlobal;
    __TAURI_IPC__?: unknown;
  }
}

export {};
