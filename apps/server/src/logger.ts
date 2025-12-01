import { Context, Effect, Layer } from "effect";
import pino from "pino";

export type LogContext = Record<string, unknown>;
export type LogFn = (
  message: string,
  context?: LogContext
) => Effect.Effect<void>;

export type LoggerService = {
  readonly debug: LogFn;
  readonly info: LogFn;
  readonly warn: LogFn;
  readonly error: LogFn;
  readonly child: (context: LogContext) => LoggerService;
};

export const LoggerService = Context.GenericTag<LoggerService>(
  "@hive/server/LoggerService"
);

const createLogger = (instance: pino.Logger): LoggerService => {
  const log =
    (level: pino.Level): LogFn =>
    (message, context) =>
      Effect.sync(() => {
        if (context) {
          instance[level](context, message);
        } else {
          instance[level](message);
        }
      });

  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (context) => createLogger(instance.child(context)),
  } satisfies LoggerService;
};

export const LoggerLayer = Layer.sync(LoggerService, () => {
  const level = process.env.LOG_LEVEL ?? "info";
  const base = pino({ level, name: "hive" });
  return createLogger(base);
});
