export function abortError(): Error {
  return new DOMException('Texture request cancelled', 'AbortError')
}

export function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AbortError'
}

export function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}
