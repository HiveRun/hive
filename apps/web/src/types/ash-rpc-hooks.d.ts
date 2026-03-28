declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: global Window augmentation requires an interface.
  interface Window {
    __AshRpcChannelHooks?: {
      beforeChannelPush?: <T>(actionName: string, config: T) => Promise<T>;
      afterChannelResponse?: (
        actionName: string,
        responseType: "ok" | "error" | "timeout",
        data: unknown,
        config: unknown
      ) => Promise<void>;
      beforeValidationChannelPush?: <T>(
        actionName: string,
        config: T
      ) => Promise<T>;
      afterValidationChannelResponse?: (
        actionName: string,
        responseType: "ok" | "error" | "timeout",
        data: unknown,
        config: unknown
      ) => Promise<void>;
    };
  }

  var __AshRpcChannelHooks: Window["__AshRpcChannelHooks"];
}

export {};
