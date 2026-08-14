import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { delimiter, join } from "node:path";

const HIVE_ANDROID_AVD_NAME = "Hive_Pixel_7";
export const HIVE_ANDROID_DEVICE_PROFILE = "pixel_7";
export const HIVE_ANDROID_DEVICE_START_TIMEOUT_MS = 300_000;

export const resolveHiveAndroidAvdName = (cellId: string): string =>
  `${HIVE_ANDROID_AVD_NAME}_${cellId.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`;

type AndroidSdkEnvironment = Readonly<Record<string, string | undefined>>;

type AndroidSdkResolutionOptions = {
  homeDirectory?: string;
  pathExists?: (candidate: string) => boolean;
  platform?: NodeJS.Platform;
  requiredRelativePaths?: string[];
};

type AndroidGraphicsOptions = {
  platform?: NodeJS.Platform;
  userId?: number;
  validateXAuthority?: (path: string, display: string) => boolean;
};

type AndroidRuntimeDirectoryOptions = {
  pathExists?: (candidate: string) => boolean;
  platform?: NodeJS.Platform;
  userId?: number;
};

type AndroidGraphicsConfiguration = {
  gpuMode: string;
  xAuthority?: string;
};

const X_DISPLAY_NUMBER_REGEX = /:(\d+)(?:\.\d+)?$/;
const XAUTH_FAMILY_LOCAL = 256;
const XAUTH_FAMILY_WILD = 65_535;
const XAUTH_COOKIE_BYTES = 16;

export const resolveAndroidSdkPath = (
  environment: AndroidSdkEnvironment = process.env,
  options: AndroidSdkResolutionOptions = {}
): string => {
  const configuredPath =
    environment.ANDROID_HOME?.trim() || environment.ANDROID_SDK_ROOT?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const homeDirectory = options.homeDirectory ?? homedir();
  const platform = options.platform ?? process.platform;
  const candidates =
    platform === "darwin"
      ? [
          join(homeDirectory, "Library/Android/sdk"),
          join(homeDirectory, "Android/Sdk"),
          join(homeDirectory, "android-sdk"),
        ]
      : [
          join(homeDirectory, "Android/Sdk"),
          join(homeDirectory, "android-sdk"),
        ];
  const pathExists = options.pathExists ?? existsSync;
  const requiredRelativePaths = options.requiredRelativePaths ?? [
    "platform-tools/adb",
  ];

  return (
    candidates.find((candidate) =>
      requiredRelativePaths.every((relativePath) =>
        pathExists(join(candidate, relativePath))
      )
    ) ??
    candidates[0] ??
    join(homeDirectory, "Android/Sdk")
  );
};

const resolveMiseShimsPath = (
  environment: AndroidSdkEnvironment = process.env,
  homeDirectory = homedir()
): string => {
  const dataDirectory =
    environment.MISE_DATA_DIR?.trim() ||
    join(
      environment.XDG_DATA_HOME?.trim() || join(homeDirectory, ".local/share"),
      "mise"
    );
  return join(dataDirectory, "shims");
};

export const createAndroidSdkEnvironment = (
  environment: NodeJS.ProcessEnv,
  options: AndroidSdkResolutionOptions = {}
): NodeJS.ProcessEnv & {
  ANDROID_HOME: string;
  ANDROID_SDK_ROOT: string;
  PATH: string;
} => {
  const sdkPath = resolveAndroidSdkPath(environment, options);
  return {
    ...environment,
    ANDROID_HOME: sdkPath,
    ANDROID_SDK_ROOT: sdkPath,
    PATH: [
      join(sdkPath, "cmdline-tools/latest/bin"),
      join(sdkPath, "platform-tools"),
      join(sdkPath, "emulator"),
      resolveMiseShimsPath(environment, options.homeDirectory),
      environment.PATH ?? "",
    ].join(delimiter),
  };
};

export const sanitizeAdbServerEnvironment = (
  environment: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => ({
  ...environment,
  ADB_SERVER_SOCKET: undefined,
  ANDROID_ADB_SERVER_ADDRESS: undefined,
  ANDROID_ADB_SERVER_PORT: undefined,
});

export const getHiveAndroidAbi = (
  architecture: NodeJS.Architecture = process.arch
): "arm64-v8a" | "x86_64" => {
  if (architecture === "x64") {
    return "x86_64";
  }
  if (architecture === "arm64") {
    return "arm64-v8a";
  }
  throw new Error(`Hive Android does not support ${architecture} hosts.`);
};

export const getHiveAndroidDeviceStartTimeoutMs = (
  env: Record<string, string | undefined> = process.env
): number => {
  const configured = Number(env.HIVE_ANDROID_DEVICE_START_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : HIVE_ANDROID_DEVICE_START_TIMEOUT_MS;
};

export const getHiveAndroidSystemImage = (
  architecture: NodeJS.Architecture = process.arch
): string =>
  `system-images;android-34;google_apis;${getHiveAndroidAbi(architecture)}`;

export const buildAndroidEmulatorArgs = (options: {
  avdName: string;
  consolePort: number;
  gpuMode: string;
  grpcPort: number;
}): string[] => [
  "-avd",
  options.avdName,
  "-port",
  String(options.consolePort),
  "-netdelay",
  "none",
  "-netspeed",
  "full",
  "-gpu",
  options.gpuMode,
  "-no-snapshot-load",
  "-no-snapshot-save",
  "-no-boot-anim",
  "-no-window",
  "-skin",
  "720x1600",
  "-prop",
  "qemu.sf.lcd_density=280",
  "-grpc",
  String(options.grpcPort),
  "-grpc-use-token",
];

export const resolveAndroidRuntimeDirectory = (
  env: AndroidSdkEnvironment,
  options: AndroidRuntimeDirectoryOptions = {}
): string | undefined => {
  const configuredRuntimeDirectory = env.XDG_RUNTIME_DIR?.trim();
  if ((options.platform ?? process.platform) !== "linux") {
    return configuredRuntimeDirectory;
  }

  const pathExists = options.pathExists ?? existsSync;
  if (
    configuredRuntimeDirectory &&
    pathExists(join(configuredRuntimeDirectory, "pulse/native"))
  ) {
    return configuredRuntimeDirectory;
  }

  const userId = options.userId ?? process.getuid?.();
  const userRuntimeDirectory =
    userId === undefined ? undefined : `/run/user/${userId}`;
  return userRuntimeDirectory &&
    pathExists(join(userRuntimeDirectory, "pulse/native"))
    ? userRuntimeDirectory
    : configuredRuntimeDirectory;
};

const hasXAuthorityCookie = (path: string, display: string): boolean => {
  const displayNumber = display.match(X_DISPLAY_NUMBER_REGEX)?.[1];
  if (!displayNumber) {
    return false;
  }

  const contents = readFileSync(path);
  let offset = 0;
  const readField = (): Buffer | undefined => {
    if (offset + 2 > contents.length) {
      return;
    }
    const length = contents.readUInt16BE(offset);
    offset += 2;
    if (offset + length > contents.length) {
      return;
    }
    const value = contents.subarray(offset, offset + length);
    offset += length;
    return value;
  };

  while (offset < contents.length) {
    if (offset + 2 > contents.length) {
      return false;
    }
    const family = contents.readUInt16BE(offset);
    offset += 2;
    const address = readField();
    const number = readField();
    const name = readField();
    const cookie = readField();
    if (!(address && number && name && cookie)) {
      return false;
    }
    if (
      (family === XAUTH_FAMILY_WILD ||
        (family === XAUTH_FAMILY_LOCAL && address.toString() === hostname())) &&
      number.toString() === displayNumber &&
      name.toString() === "MIT-MAGIC-COOKIE-1" &&
      cookie.length === XAUTH_COOKIE_BYTES
    ) {
      return true;
    }
  }
  return false;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: X authority validation requires platform, owner, cookie, and freshness checks.
export function resolveAndroidGraphics(
  env: AndroidSdkEnvironment,
  options: AndroidGraphicsOptions = {}
): AndroidGraphicsConfiguration {
  const display = env.DISPLAY?.trim();
  const userId = options.userId ?? process.getuid?.();
  const validateXAuthority =
    options.validateXAuthority ??
    ((path: string, activeDisplay: string): boolean => {
      try {
        const authority = statSync(path);
        if (
          !authority.isFile() ||
          (userId !== undefined && authority.uid !== userId)
        ) {
          return false;
        }
        return hasXAuthorityCookie(path, activeDisplay);
      } catch {
        return false;
      }
    });
  const configuredXAuthority = env.XAUTHORITY?.trim();
  let xAuthority =
    configuredXAuthority &&
    display &&
    validateXAuthority(configuredXAuthority, display)
      ? configuredXAuthority
      : undefined;

  if (
    !xAuthority &&
    display &&
    (options.platform ?? process.platform) === "linux"
  ) {
    const runtimeDirectory =
      env.XDG_RUNTIME_DIR?.trim() ||
      (userId === undefined ? undefined : `/run/user/${userId}`);
    if (runtimeDirectory) {
      try {
        xAuthority = readdirSync(runtimeDirectory, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.startsWith("xauth_"))
          .map((entry) => join(runtimeDirectory, entry.name))
          .filter((path) => validateXAuthority(path, display))
          .sort(
            (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs
          )
          .at(0);
      } catch {
        xAuthority = undefined;
      }
    }
  }

  const configuredGpuMode = env.ANDROID_EMULATOR_GPU_MODE?.trim();
  return {
    gpuMode: configuredGpuMode || (display && xAuthority ? "host" : "auto"),
    ...(xAuthority ? { xAuthority } : {}),
  };
}
