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
 * Снимок снимается после каждой разборки. Первый за сессию становится
 * эталоном; любой последующий выше эталона означает, что разборка что-то
 * не освободила.
 *
 * Эталон, а не ноль: ноль недостижим, потому что часть ресурсов существует
 * законно на всё приложение — общий шум аккреционного диска, материал
 * прицела, заглушки ResourceStorage.generateTexture. Эталон учитывает их
 * автоматически, поэтому подбирать допуски не нужно.
 *
 * Следствие: утечка видна со второго переключения сценария, а не с первого.
 */
class LeakDetector {
  private baseline: MemorySnapshot | null = null

  public constructor(private readonly renderer: WebGLRenderer) {}

  public record(): MemoryLeak | null {
    const current: MemorySnapshot = {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures
    }

    if (!this.baseline) {
      this.baseline = current

      return null
    }

    const leak: MemoryLeak = {
      geometries: current.geometries - this.baseline.geometries,
      textures: current.textures - this.baseline.textures
    }

    return leak.geometries > 0 || leak.textures > 0 ? leak : null
  }
}

export { LeakDetector }
