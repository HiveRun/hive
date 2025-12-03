const defaultError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

type ResultBase<T, E> = {
  isOk: () => this is OkResult<T>;
  isErr: () => this is ErrResult<T, E>;
  unwrapOr: (fallback: T) => T;
};

export type OkResult<T> = ResultBase<T, never> & {
  readonly _tag: "ok";
  readonly value: T;
  readonly error?: undefined;
};

export type ErrResult<T, E> = ResultBase<T, E> & {
  readonly _tag: "err";
  readonly value?: undefined;
  readonly error: E;
};

export type Result<T, E> = OkResult<T> | ErrResult<T, E>;

export type ResultAsync<T, E> = Promise<Result<T, E>>;

const makeOk = <T>(value: T): OkResult<T> => ({
  _tag: "ok",
  value,
  isOk(): this is OkResult<T> {
    return true;
  },
  isErr(): this is ErrResult<T, never> {
    return false;
  },
  unwrapOr: () => value,
});

const makeErr = <T, E>(error: E): ErrResult<T, E> => ({
  _tag: "err",
  error,
  isOk(): this is OkResult<T> {
    return false;
  },
  isErr(): this is ErrResult<T, E> {
    return true;
  },
  unwrapOr: (fallback: T) => fallback,
});
export const ok = <T, E = never>(value: T): Result<T, E> => makeOk<T>(value);

export const err = <T = never, E = Error>(error: E): Result<T, E> =>
  makeErr<T, E>(error);

export function okAsync(): ResultAsync<void, never>;
export function okAsync<T, E = never>(value: T): ResultAsync<T, E>;
export function okAsync<T, E = never>(value?: T): ResultAsync<T, E> {
  return Promise.resolve(ok<T, E>(value as T));
}

export const errAsync = <T = never, E = Error>(error: E): ResultAsync<T, E> =>
  Promise.resolve(err<T, E>(error));

export function safeSync<T, E = Error>(
  fn: () => T,
  onError?: (error: unknown) => E
): Result<T, E> {
  try {
    return ok<T, E>(fn());
  } catch (error) {
    const mapped = onError ? onError(error) : (defaultError(error) as E);
    return err<T, E>(mapped);
  }
}

export function safeAsync<T, E = Error>(
  fn: () => Promise<T> | T,
  onError?: (error: unknown) => E
): ResultAsync<T, E> {
  return Promise.resolve().then(async () => {
    try {
      const value = await fn();
      return ok<T, E>(value);
    } catch (error) {
      const mapped = onError ? onError(error) : (defaultError(error) as E);
      return err<T, E>(mapped);
    }
  });
}
