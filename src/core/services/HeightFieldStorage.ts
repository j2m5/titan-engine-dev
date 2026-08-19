import { Storage } from '@/core/framework/file/Storage'
import { config } from '@/core/framework/config'
import { parseHeightMap, type HeightMapData } from '@/core/terrain/heightMapFormat'

/**
 * Реестр карт высот, CPU-сторона. Модульный синглтон по образцу
 * resourceStorage: конструкторы renderables (Planet) читают его синхронно,
 * DI им недоступен.
 *
 * Мимо текстурного конвейера намеренно: height — не текстура, а Uint16-данные
 * для смещения вершин и коллизии; ImageBitmap к тому же режет 16 бит до 8.
 *
 * Режим спросовый: карты приходят по request() от HeightFieldGate и уходят
 * по release(), когда тело ушло далеко. Жадная загрузка всего сценария
 * стоила 788 МиБ и 12.4 с на старте — при том, что за сессию посещают
 * единицы тел.
 */
class HeightFieldStorage {
  private maps: Map<string, HeightMapData> = new Map()

  /** Пути, чей fetch ещё не завершился: пинятся от release (см. докблок release). */
  private inFlight: Set<string> = new Set()

  /** Путь → Date.now() последнего провала. Ключ уходит по истечении бэкоффа. */
  private failedAt: Map<string, number> = new Map()

  /**
   * Номер сценария. Захватывается до первого await; при расхождении по
   * возвращении результат выбрасывается, а состояние по ключу не трогается —
   * под ним уже может лежать запись новой эпохи.
   */
  private epoch: number = 0

  private registryVersion: number = 0

  /**
   * Растёт на любом изменении состава реестра. CameraCollision перечитывает
   * реестр только при смене ссылки sceneObserver.objects, то есть при смене
   * сцены; прибытие карты в середине сценария прошло бы мимо коллизии.
   */
  public get version(): number {
    return this.registryVersion
  }

  public get(path: string): HeightMapData | undefined {
    return this.maps.get(path)
  }

  /** Загруженные плюс летящие: то, за что гейт уже «заплатил». */
  public heldPaths(): string[] {
    return [...new Set([...this.maps.keys(), ...this.inFlight])]
  }

  /**
   * Идемпотентен: карта уже есть, уже летит или недавно провалилась — выход
   * без сети. Промис не возвращается намеренно: вызывающий (гейт) работает
   * по опросу состояния, а не по колбэку завершения.
   */
  public request(path: string): void {
    if (this.maps.has(path) || this.inFlight.has(path)) return

    const failed: number | undefined = this.failedAt.get(path)

    if (failed !== undefined) {
      if (Date.now() - failed < config('streaming.retryBackoffMs')) return

      this.failedAt.delete(path)
    }

    this.inFlight.add(path)
    void this.fetchInto(path, this.epoch)
  }

  /**
   * Путь в полёте не трогается: иначе догрузка после await записала бы карту
   * в уже вычищенное состояние, и она осталась бы резидентной вне учёта
   * навсегда. Отпустится на следующем пересчёте, когда прилетит.
   */
  public release(path: string): void {
    if (this.inFlight.has(path)) return
    if (!this.maps.delete(path)) return

    this.registryVersion += 1
  }

  public clear(): void {
    this.epoch += 1
    this.maps.clear()
    this.inFlight.clear()
    this.failedAt.clear()
    this.registryVersion += 1
  }

  private async fetchInto(path: string, epoch: number): Promise<void> {
    try {
      const response = await fetch(Storage.url(path))

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const map: HeightMapData = parseHeightMap(await response.arrayBuffer())

      if (epoch !== this.epoch) return

      this.maps.set(path, map)
      this.registryVersion += 1
    } catch (cause) {
      console.warn(`[HeightFieldStorage] карта высот не загружена: ${path}`, cause)

      if (epoch === this.epoch) this.failedAt.set(path, Date.now())
    } finally {
      // Только своя эпоха: после clear() под этим ключом уже может лежать
      // запись новой эпохи, и удалить её значило бы разрешить дубль-fetch.
      if (epoch === this.epoch) this.inFlight.delete(path)
    }
  }
}

export const heightFieldStorage = new HeightFieldStorage()
