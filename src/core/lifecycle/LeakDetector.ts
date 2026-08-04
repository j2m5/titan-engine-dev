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
 * Планка, а не ноль: часть ресурсов законно живёт всё приложение (шум
 * аккреционного диска, материал прицела, заглушка текстуры). Планка учитывает
 * их сама, подбирать допуски не нужно.
 *
 * Прирост, а не разность с первым снимком: ресурсы уровня приложения создаются
 * лениво, и неподвижный эталон вечно считал бы утечкой законную текстуру,
 * появившуюся после его снятия. С планкой она даёт одно предупреждение и
 * замолкает, а настоящая утечка растёт на каждой разборке.
 *
 * Планка ведётся по каждому счётчику отдельно и не опускается: сцены разной
 * тяжести дают разный уровень выживших.
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
