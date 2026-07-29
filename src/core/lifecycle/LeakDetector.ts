import type { WebGLRenderer } from 'three'

export interface MemoryLeak {
  geometries: number
  textures: number
}

interface MemorySnapshot {
  geometries: number
  textures: number
}

/**
 * Проверка утечек по живым счётчикам three.js.
 *
 * Снимок снимается после каждой разборки, и сравнивается он не с
 * зафиксированным эталоном, а с **планкой** — наибольшим уровнем, который
 * счётчики принимали за сессию. Возвращается прирост над планкой, после чего
 * планка поднимается на новый уровень.
 *
 * Планка, а не ноль: ноль недостижим, потому что часть ресурсов существует
 * законно на всё приложение — общий шум аккреционного диска, материал прицела,
 * заглушка `PlaceholderTexture`. Планка учитывает их сама, поэтому
 * подбирать допуски не нужно.
 *
 * Прирост, а не разность с первым снимком, — из-за замера 27.07.2026.
 * Неподвижный эталон достоверен только для ресурсов, существовавших к моменту
 * его снятия, а ресурсы уровня приложения создаются лениво: текстура шума
 * чёрной дыры появляется при первом же материале дыры. Если дыру показали
 * позже, чем снят эталон, одна законная текстура читалась как утечка `+1`
 * вечно — ровно это и наблюдалось. С планкой она даёт одно предупреждение и
 * замолкает, а настоящая утечка сообщает о себе на каждой разборке, потому
 * что растёт каждый раз.
 *
 * Планка берётся по каждому счётчику отдельно и никогда не опускается: сцены
 * разной тяжести дают разный уровень выживших, и возврат к прежнему уровню
 * после более лёгкой сцены приростом не является.
 *
 * Следствие: утечка видна со второго переключения сценария, а не с первого.
 */
class LeakDetector {
  private peak: MemorySnapshot | null = null

  public constructor(private readonly renderer: WebGLRenderer) {}

  public record(): MemoryLeak | null {
    const current: MemorySnapshot = {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures
    }

    if (!this.peak) {
      this.peak = current

      return null
    }

    const growth: MemoryLeak = {
      geometries: Math.max(0, current.geometries - this.peak.geometries),
      textures: Math.max(0, current.textures - this.peak.textures)
    }

    if (growth.geometries === 0 && growth.textures === 0) return null

    this.peak = {
      geometries: Math.max(this.peak.geometries, current.geometries),
      textures: Math.max(this.peak.textures, current.textures)
    }

    return growth
  }
}

export { LeakDetector }
