/** В r182 dispose-замыкания сохраняют буферы старого контекста. */
interface ThreeDisposable {
  _listeners?: { dispose?: ((event: unknown) => void)[] }
  removeEventListener(type: never, listener: never): void
}

const ownerListeners = new WeakMap<object, Set<(event: unknown) => void>>()

/** Зарегистрировать собственные wrappers до первого использования renderer-ом. */
export function rememberImpostorContext(...resources: object[]): void {
  for (const resource of resources) if (!ownerListeners.has(resource)) {
    ownerListeners.set(resource, new Set((resource as ThreeDisposable)._listeners?.dispose ?? []))
  }
}

/** Есть GPU-владелец, зарегистрированный после собственных dispose-подписок. */
export function hasImpostorContext(resource: object): boolean {
  const keep = ownerListeners.get(resource)
  return !!keep && ((resource as ThreeDisposable)._listeners?.dispose ?? []).some(listener => !keep.has(listener))
}

/** Только после contextlost, до повторного использования объекта renderer-ом. */
export function forgetImpostorContext(...resources: object[]): void {
  for (const resource of resources) {
    const events = resource as ThreeDisposable
    const keep = ownerListeners.get(resource)
    if (!keep) continue
    for (const listener of [...(events._listeners?.dispose ?? [])]) {
      if (!keep.has(listener)) events.removeEventListener('dispose' as never, listener as never)
    }
  }
}
