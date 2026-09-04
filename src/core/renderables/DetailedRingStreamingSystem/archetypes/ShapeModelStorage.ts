import { Storage } from '@/core/framework/file/Storage'
import { parseShapeModel, shapeModelPath, type ShapeModelData, type ShapeModelTier } from './ShapeModelFormat'

/**
 * Загрузка реальных моделей форм (`asteroids/shapes/<имя>_<ярус>.bin`) через
 * тот же путь, что у карт высот: fetch(Storage.url(path)) → ShapeModelFormat.
 *
 * Кэш на сессию по (имя, ярус): один запрос на модель при любом числе колец
 * одного профиля; результат делится по ссылке. Любой сбой — HTTP-ошибка, сеть,
 * битый буфер — даёт null и тоже кэшируется: кольцо остаётся на процедурной
 * заглушке архетипа, повторных запросов нет.
 */
class ShapeModelStorage {
  private readonly cache = new Map<string, Promise<ShapeModelData | null>>()

  public constructor(private readonly fetchFn: typeof fetch = (...args) => globalThis.fetch(...args)) {}

  public load(name: string, tier: ShapeModelTier): Promise<ShapeModelData | null> {
    const key = `${name}|${tier}`
    const cached = this.cache.get(key)
    if (cached) return cached

    const pending = this.fetchModel(shapeModelPath(name, tier))
    this.cache.set(key, pending)
    return pending
  }

  private async fetchModel(path: string): Promise<ShapeModelData | null> {
    try {
      const response = await this.fetchFn(Storage.url(path))
      if (!response.ok) return null
      return parseShapeModel(await response.arrayBuffer())
    } catch {
      return null
    }
  }
}

/** Общее хранилище приложения (модуль-синглтон, как resourceStorage) */
const shapeModelStorage = new ShapeModelStorage()

export { ShapeModelStorage, shapeModelStorage }
