import { Result, ResultAsync } from "neverthrow";

type ErrorMapper<E> = (error: unknown) => E;

const defaultError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export function safeSync<T, E = Error>(
  fn: () => T,
  onError?: ErrorMapper<E>
): Result<T, E> {
  return Result.fromThrowable(fn, (error) =>
    onError ? onError(error) : (defaultError(error) as E)
  )();
}

export function safeAsync<T, E = Error>(
  fn: () => Promise<T> | T,
  onError?: ErrorMapper<E>
): ResultAsync<T, E> {
  return ResultAsync.fromPromise(Promise.resolve().then(fn), (error) =>
    onError ? onError(error) : (defaultError(error) as E)
  );
}
