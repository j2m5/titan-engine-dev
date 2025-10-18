export type EventCallback = (...args: any[]) => void

class EventEmitter {
  private readonly events: Record<string, EventCallback[]>

  public constructor() {
    this.events = {}
  }

  public subscribe(event: string, callback: EventCallback): void {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event].push(callback)
  }

  public unsubscribe(event: string, callback: EventCallback): void {
    const callbacks: EventCallback[] = this.events[event]
    if (callbacks) {
      this.events[event] = callbacks.filter((fn: EventCallback): boolean => fn !== callback)
    }
  }

  public emit(event: string, ...args: any[]): void {
    const callbacks: EventCallback[] = this.events[event]
    if (callbacks) {
      callbacks.forEach((callback: EventCallback): void => {
        callback(...args)
      })
    }
  }
}

export { EventEmitter }
