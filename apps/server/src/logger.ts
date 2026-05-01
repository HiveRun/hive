import pino from "pino";

type LogContext = Record<string, unknown>;
type SyncLogFn = (message: string, context?: LogContext) => void;

export type LoggerService = {
  readonly debug: SyncLogFn;
  readonly info: SyncLogFn;
  readonly warn: SyncLogFn;
  readonly error: SyncLogFn;
  readonly child: (context: LogContext) => LoggerService;
};

const createLogger = (instance: pino.Logger): LoggerService => {
  const log =
    (logLevel: pino.Level): SyncLogFn =>
    (message, context) =>
      context
        ? instance[logLevel](context, message)
        : instance[logLevel](message);

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (context) => createLogger(instance.child(context)),
  } satisfies LoggerService;
};

const level = process.env.LOG_LEVEL ?? "info";
const base = pino({ level, name: "hive" });

const loggerService = createLogger(base);

export const LoggerService = loggerService;
