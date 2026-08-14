import { runAndroidEmulator } from "./emulator";
import { runAndroidViewer } from "./viewer";

export type AndroidEmulatorCommand = {
  grpcPort: number;
  kind: "emulator";
  productArgv: string[];
};

export type AndroidViewerCommand = {
  grpcPort: number;
  kind: "viewer";
  port: number;
};

export type AndroidCommand = AndroidEmulatorCommand | AndroidViewerCommand;

type AndroidCommandDispatchOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  runEmulator?: typeof runAndroidEmulator;
  runViewer?: typeof runAndroidViewer;
  writeError?: (message: string) => void;
};

const MAX_TCP_PORT = 65_535;

const parsePort = (flag: string, value: string | undefined): number => {
  const port = Number(value);
  if (!(Number.isInteger(port) && port > 0 && port <= MAX_TCP_PORT)) {
    throw new Error(
      `${flag} requires a valid TCP port, got ${value ?? "missing"}.`
    );
  }
  return port;
};

const parseOptions = (
  argv: string[],
  allowedFlags: ReadonlySet<string>
): Map<string, string> => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!(flag && allowedFlags.has(flag))) {
      throw new Error(`Unknown Android option ${flag ?? "missing"}.`);
    }
    if (values.has(flag)) {
      throw new Error(`Android option ${flag} may only be provided once.`);
    }
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    values.set(flag, value);
  }
  return values;
};

const parseEmulatorCommand = (argv: string[]): AndroidEmulatorCommand => {
  const separator = argv.indexOf("--");
  if (separator < 0) {
    throw new Error(
      "Usage: hive android emulator --grpc-port <port> -- <product argv...>"
    );
  }
  const options = parseOptions(
    argv.slice(0, separator),
    new Set(["--grpc-port"])
  );
  const productArgv = argv.slice(separator + 1);
  if (productArgv.length === 0) {
    throw new Error("Android emulator requires a trailing product command.");
  }
  return {
    grpcPort: parsePort("--grpc-port", options.get("--grpc-port")),
    kind: "emulator",
    productArgv,
  };
};

const parseViewerCommand = (argv: string[]): AndroidViewerCommand => {
  const options = parseOptions(argv, new Set(["--grpc-port", "--port"]));
  return {
    grpcPort: parsePort("--grpc-port", options.get("--grpc-port")),
    kind: "viewer",
    port: parsePort("--port", options.get("--port")),
  };
};

export const parseAndroidCommand = (argv: string[]): AndroidCommand | null => {
  if (argv[0] !== "android") {
    return null;
  }
  if (argv[1] === "emulator") {
    return parseEmulatorCommand(argv.slice(2));
  }
  if (argv[1] === "viewer") {
    return parseViewerCommand(argv.slice(2));
  }
  throw new Error(
    `Unknown Android command ${argv[1] ?? "missing"}. Expected emulator or viewer.`
  );
};

export const assertAndroidPlatformSupported = (
  platform: NodeJS.Platform = process.platform
): void => {
  if (platform !== "linux" && platform !== "darwin") {
    throw new Error(
      `Hive Android commands are not supported on ${platform}. Run Hive on a Linux or macOS host with the Android SDK installed.`
    );
  }
};

export const dispatchAndroidEmulatorCommand = (
  command: AndroidEmulatorCommand,
  options: AndroidCommandDispatchOptions = {}
): Promise<number> =>
  (options.runEmulator ?? runAndroidEmulator)({
    env: options.env,
    grpcPort: command.grpcPort,
    productArgv: command.productArgv,
  });

export const dispatchAndroidViewerCommand = (
  command: AndroidViewerCommand,
  options: AndroidCommandDispatchOptions = {}
): Promise<number> =>
  (options.runViewer ?? runAndroidViewer)({
    env: options.env,
    grpcPort: command.grpcPort,
    port: command.port,
  });

export const dispatchAndroidCommand = async (
  argv: string[],
  options: AndroidCommandDispatchOptions = {}
): Promise<number | null> => {
  if (argv[0] !== "android") {
    return null;
  }
  try {
    assertAndroidPlatformSupported(options.platform);
    const command = parseAndroidCommand(argv);
    if (!command) {
      return null;
    }
    return command.kind === "emulator"
      ? await dispatchAndroidEmulatorCommand(command, options)
      : await dispatchAndroidViewerCommand(command, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (options.writeError ?? ((value) => process.stderr.write(value)))(
      `Hive Android command failed: ${message}\n`
    );
    return 1;
  }
};
