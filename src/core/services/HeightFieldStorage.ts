import { Actor } from '@/core/models/Actor'
import { Storage } from '@/core/framework/file/Storage'
import { parseHeightMap, type HeightMapData } from '@/core/terrain/heightMapFormat'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { ScenarioConfig } from '@/config/scenarios'

/**
 * Реестр карт высот, CPU-сторона. Модульный синглтон по образцу
 * resourceStorage: конструкторы renderables (Planet) читают его синхронно,
 * DI им недоступен.
 *
 * Мимо текстурного конвейера намеренно: height — не текстура, а Uint16-данные
 * для смещения вершин и (этап 2) коллизии; ImageBitmap к тому же режет
 * 16 бит до 8. Загрузка — до построения сцены (Application.run), чтобы
 * конструктор Planet видел данные синхронно.
 */
class HeightFieldStorage {
  private maps: Map<string, HeightMapData> = new Map()

  public get(path: string): HeightMapData | undefined {
    return this.maps.get(path)
  }

  /**
   * Провал одной карты — warn и пропуск, не исключение: Planet без карты
   * откатывается на гладкую сферу, ронять загрузку сценария не за что.
   */
  public async load(paths: string[], reporter?: LoadingProgressReporter): Promise<void> {
    for (const path of paths) {
      if (this.maps.has(path)) continue

      reporter?.setAsset(path)

      try {
        const response = await fetch(Storage.url(path))

        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        this.maps.set(path, parseHeightMap(await response.arrayBuffer()))
      } catch (cause) {
        console.warn(`[HeightFieldStorage] карта высот не загружена: ${path}`, cause)
      }
    }
  }

  /** Карты всех тел сценария: корень + рекурсивно дети, как setMap у ResourceObserver. */
  public async loadForScenario(scenario: ScenarioConfig, reporter?: LoadingProgressReporter): Promise<void> {
    const root: Actor | null = Actor.find(scenario.rootId)

    if (!root) return

    const paths: string[] = []
    const collect = (actor: Actor): void => {
      const path = actor.resources.where('resourceType', 'height').first()?.getAttribute('path')

      if (typeof path === 'string') paths.push(path)
    }

    collect(root)
    root.children.eachRecursive(collect)

    await this.load(paths, reporter)
  }

  public clear(): void {
    this.maps.clear()
  }
}

export const heightFieldStorage = new HeightFieldStorage()
