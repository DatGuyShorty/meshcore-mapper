export type AbortLikeError = Error & {
  cancelled?: boolean;
};

type RunFallbackJobOptions<TBackend extends string, TResult, TUnsupported> = {
  backends: TBackend[];
  signal?: AbortSignal | null;
  runBackend: (backend: TBackend) => Promise<TResult | TUnsupported>;
  isUnsupported: (result: TResult | TUnsupported) => result is TUnsupported;
  describeUnsupported: (backend: TBackend, result: TUnsupported) => string;
  describeError: (backend: TBackend, error: unknown) => string;
  allFailedMessage: (errors: string[]) => string;
  onBackendError?: (backend: TBackend, error: unknown) => void;
};

export function createAbortError(message = 'Cancelled'): AbortLikeError {
  const err = new Error(message) as AbortLikeError;
  err.name = 'AbortError';
  err.cancelled = true;
  return err;
}

export function isAbortLikeError(error: unknown): boolean {
  const err = error as AbortLikeError | null;
  return Boolean(err?.name === 'AbortError' || err?.cancelled);
}

export async function runFallbackJob<TBackend extends string, TResult, TUnsupported>({
  backends,
  signal = null,
  runBackend,
  isUnsupported,
  describeUnsupported,
  describeError,
  allFailedMessage,
  onBackendError,
}: RunFallbackJobOptions<TBackend, TResult, TUnsupported>): Promise<TResult> {
  const errors: string[] = [];

  for (const backend of backends) {
    if (signal?.aborted) throw createAbortError();
    try {
      const result = await runBackend(backend);
      if (isUnsupported(result)) {
        errors.push(describeUnsupported(backend, result));
        continue;
      }
      return result;
    } catch (error) {
      if (isAbortLikeError(error)) throw error;
      errors.push(describeError(backend, error));
      onBackendError?.(backend, error);
    }
  }

  throw new Error(allFailedMessage(errors));
}
