import type { Object3D } from 'three'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import type { AtmosphereLUTs } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'

/** Запись атмосферы для полноэкранного эффекта. LUT принадлежат узлу. */
export interface AtmosphereEntry {
  actorId: number
  name: string
  /** Узел сцены: `matrixWorld` — центр оболочки (читается эффектом в момент рендера, без лага кадра) */
  object: Object3D
  /** Подогнанный конфиг — тот же, из которого считались LUT (см. terrainFloorAdjust) */
  config: AtmosphereConfig
  lut: AtmosphereLUTs
}

/**
 * Реестр атмосфер сцены. Узел регистрируется при создании и снимается в
 * dispose(); эффект композера читает снимок каждый кадр.
 */
export class AtmosphereRegistry {
  private readonly byActor = new Map<number, AtmosphereEntry>()

  public register(entry: AtmosphereEntry): void {
    this.byActor.set(entry.actorId, entry)
  }

  public unregister(actorId: number): void {
    this.byActor.delete(actorId)
  }

  /** Точечный доступ по actorId атмосферы — материалы тел читают свою запись каждый видимый кадр. */
  public get(actorId: number): AtmosphereEntry | undefined {
    return this.byActor.get(actorId)
  }

  public entries(): readonly AtmosphereEntry[] {
    return Array.from(this.byActor.values())
  }

  public get size(): number {
    return this.byActor.size
  }
}
