import type { CubeTexture, Object3D } from 'three'

/**
 * Гравитационная линза для экранного прохода дальнего поля
 * (GravitationalLensEffect): меш сильной зоны (L0 чёрной дыры), радиус
 * Шварцшильда и радиус зоны в юнитах сцены. Кубмапа фона — подстраховка для
 * сдвинутых выборок, ушедших за экран или в диск меша.
 */
export interface LensEntry {
  /** Меш L0: мировая позиция и видимость (импостор активен → линза выключена) */
  object: Object3D
  /** rsVisual в юнитах сцены */
  rsUnits: number
  /** Радиус зоны симуляции (меша) в юнитах сцены */
  simulationRadiusUnits: number
  /** Фоновая кубмапа сцены на текущий кадр */
  background: () => CubeTexture | null
}

/**
 * Реестр линз: чёрная дыра регистрируется при создании и снимается в dispose,
 * эффект читает снимок каждый кадр — как DepthVolumeRegistry для объёмов.
 */
export class LensRegistry {
  private readonly items = new Set<LensEntry>()

  public register(entry: LensEntry): void {
    this.items.add(entry)
  }

  public unregister(entry: LensEntry): void {
    this.items.delete(entry)
  }

  public entries(): readonly LensEntry[] {
    return Array.from(this.items)
  }

  public get size(): number {
    return this.items.size
  }
}
