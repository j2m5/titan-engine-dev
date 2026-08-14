/** Карта событий: имя события → кортеж типов его аргументов */
export type EventMap = Record<string, unknown[]>

class EventEmitter<TEvents extends EventMap = EventMap> {
  private readonly events: { [K in keyof TEvents]?: Array<(...args: TEvents[K]) => void> }

  public constructor() {
    this.events = {}
  }

  public subscribe<K extends keyof TEvents>(event: K, callback: (...args: TEvents[K]) => void): void {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event]!.push(callback)
  }

  public unsubscribe<K extends keyof TEvents>(event: K, callback: (...args: TEvents[K]) => void): void {
    const callbacks = this.events[event]
    if (callbacks) {
      this.events[event] = callbacks.filter((fn): boolean => fn !== callback)
    }
  }

  public emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): void {
    const callbacks = this.events[event]
    if (callbacks) {
      callbacks.forEach((callback): void => {
        callback(...args)
      })
    }
  }
}

export { EventEmitter }
