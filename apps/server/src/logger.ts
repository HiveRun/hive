import pino from "pino";

export type LogContext = Record<string, unknown>;
export type SyncLogFn = (message: string, context?: LogContext) => void;

export type LoggerService = {
  readonly debug: SyncLogFn;
  readonly info: SyncLogFn;
  readonly warn: SyncLogFn;
  readonly error: SyncLogFn;
  readonly child: (context: LogContext) => LoggerService;
};

export type SyncLoggerService = {
  readonly debug: SyncLogFn;
  readonly info: SyncLogFn;
  readonly warn: SyncLogFn;
  readonly error: SyncLogFn;
  readonly child: (context: LogContext) => SyncLoggerService;
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

export const loggerService = createLogger(base);

const createSyncLogger = (instance: pino.Logger): SyncLoggerService => {
  const log =
    (logLevel: pino.Level): SyncLogFn =>
    (message, context) => {
      if (context) {
        instance[logLevel](context, message);
      } else {
        instance[logLevel](message);
      }
    };

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (context) => createSyncLogger(instance.child(context)),
  } satisfies SyncLoggerService;
};

export const syncLoggerService = createSyncLogger(base);

export const createLoggerService = () => {
  const resolvedLevel = process.env.LOG_LEVEL ?? "info";
  const resolvedBase = pino({ level: resolvedLevel, name: "hive" });
  return createLogger(resolvedBase);
};

export const LoggerService = loggerService;
