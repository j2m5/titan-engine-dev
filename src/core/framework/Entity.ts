export type Constructor<T> = new (...args: any[]) => T

class Entity {
  public id: number = 0
  protected readonly components: object[] = []

  public getComponent<T>(type: Constructor<T>): T {
    for (const component of this.components) {
      if (component instanceof type) {
        return component as unknown as T
      }
    }

    throw new Error('No component available, use Entity#hasComponent to check existence first')
  }

  public addComponent(component: object): void {
    this.components.push(component)
  }

  public addComponents(...components: object[]): void {
    for (const component of components) {
      this.addComponent(component)
    }
  }

  public hasComponent<T>(type: Constructor<T>): boolean {
    for (const component of this.components) {
      if (component instanceof type) {
        return true
      }
    }

    return false
  }

  public hasComponents<T>(...types: Constructor<T>[]): boolean {
    for (const type of types) {
      if (this.hasComponent(type)) {
        return true
      }
    }

    return false
  }
}

export { Entity }
