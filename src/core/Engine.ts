import { injectable } from 'inversify'
import { EventEmitter } from '@/core/framework/EventEmitter'
import { Entity } from '@/core/framework/Entity'
import { System } from '@/core/framework/System'
import { threeJS } from '@/core/graphic/ThreeJS'
import { timeStore } from '@/ui/mobX/TimeStore'
import { DAY } from '@/core/constants'

@injectable()
class Engine extends EventEmitter {
  private _entities: Entity[] = []
  private _systems: System[] = []

  private running: boolean = false

  private readonly boundOnResize: () => void
  private readonly boundOnVisibilityChange: () => void
  private readonly boundOnFrameRendered: () => void

  public constructor() {
    super()
    this.boundOnResize = this.onResize.bind(this)
    this.boundOnVisibilityChange = this.onVisibilityChange.bind(this)
    this.boundOnFrameRendered = this.onFrameRendered.bind(this)

    addEventListener('resize', this.boundOnResize)
    addEventListener('visibilitychange', this.boundOnVisibilityChange)
  }

  public get entities(): Entity[] {
    return this._entities
  }

  public get systems(): System[] {
    return this._systems
  }

  public addSystem(system: System): void {
    this._systems.push(system)
    system.initialize(this)
  }

  public addEntity(entity: Entity): void {
    this.emit('EntityAdded', entity)
    this._entities.push(entity)
  }

  public removeEntity(entity: Entity): void {
    const index: number = this._entities.indexOf(entity)

    if (index === -1) return

    this.emit('EntityRemoved', entity)

    this._entities.splice(index, 1)
  }

  public start(): void {
    if (!this.running) {
      this.running = true

      for (const system of this._systems) {
        const filteredEntities: Entity[] = this._entities.filter(system.appliesTo)

        for (const entity of filteredEntities) {
          system.addEntity(entity)
        }
      }

      this.subscribe('EntityAdded', (event: Entity): void => {
        for (const system of this._systems) {
          if (system.appliesTo(event)) {
            system.addEntity(event)
          }
        }
      })

      this.subscribe('EntityRemoved', (event: Entity): void => {
        for (const system of this._systems) {
          if (system.appliesTo(event)) {
            system.removeEntity(event)
          }
        }
      })

      this.update()
    }
  }

  public stop(): void {
    threeJS.renderer.setAnimationLoop(null)

    this.running = false
  }

  public update(): void {
    if (this.running) {
      this.onFrameRendered()
    }
  }

  public dispose(): void {
    if (!this.running) return

    removeEventListener('resize', this.boundOnResize)
    removeEventListener('visibilitychange', this.boundOnVisibilityChange)

    this._entities = []
    this._systems = []

    this.stop()
  }

  private onFrameRendered(): void {
    const delta: number = threeJS.clock.getDelta()
    for (const system of this._systems) {
      system.update(delta, this)
    }

    threeJS.renderer.setAnimationLoop(this.boundOnFrameRendered)
    timeStore.setEpoch(timeStore.epoch + (delta * timeStore.speedOfTime) / DAY)
  }

  private onResize(): void {
    const { innerHeight, innerWidth } = window

    threeJS.renderer.setSize(innerWidth, innerHeight)
    threeJS.camera.aspect = innerWidth / innerHeight
    threeJS.camera.updateProjectionMatrix()
  }

  private onVisibilityChange(): void {
    if (document.hidden) {
      console.warn('Stopping app due to visibility change')
      this.stop()
    } else {
      console.info('Starting app after visibility change')
      this.start()
    }
  }
}

export { Engine }
