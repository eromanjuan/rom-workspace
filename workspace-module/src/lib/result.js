export function resultError(result) {
  if (!result) return null;
  if (result instanceof Error) return result;
  return result.error || null;
}

export function toError(value, fallback = 'Request failed') {
  if (value instanceof Error) return value;
  const error = new Error(value?.message || fallback);
  if (value && typeof value === 'object') Object.assign(error, value);
  return error;
}

export function requireOk(result, fallback = 'Request failed') {
  const failure = resultError(result);
  if (failure) throw toError(failure, fallback);
  return result?.data;
}

export async function settleObserved(promise, onError, fallback = 'Background request failed') {
  try {
    const result = await promise;
    const failure = resultError(result);
    if (failure) onError?.(toError(failure, fallback));
    return result;
  } catch (error) {
    onError?.(toError(error, fallback));
    return { data: null, error: toError(error, fallback) };
  }
}
