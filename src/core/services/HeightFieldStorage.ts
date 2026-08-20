import { Storage } from '@/core/framework/file/Storage'
import { config } from '@/core/framework/config'
import {
  HEIGHT_MAP_HEADER_BYTES,
  parseHeightMap,
  parseHeightMapHeader,
  type HeightMapData,
  type HeightMapHeader
} from '@/core/terrain/heightMapFormat'

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
   * Заголовки карт (24 байта): пол рельефа нужен атмосфере в КОНСТРУКТОРЕ —
   * до того, как спросовый гейт привезёт полную карту. Факт файла, не
   * сценария: clear() не трогает, повторный сценарий не перечитывает.
   */
  private headers: Map<string, HeightMapHeader> = new Map()

  /**
   * Номер сценария. Захватывается до первого await; при расхождении по
   * возвращении результат выбрасывается, а состояние по ключу не трогается —
   * под ним уже может лежать запись новой эпохи.
   */
  private epoch: number = 0

  private registryVersion: number = 0

  /**
   * Растёт на любом изменении состава реестра.
   *
   * CameraCollision перечитывает реестр при смене ссылки
   * sceneObserver.objects ЛИБО при росте этой версии. Ссылка меняется не
   * только при смене сцены: её пересобирает и подмена поверхности тела в
   * рантайме (HeightFieldGate.recompute → SceneObserver.refreshObservableObjects).
   * Версия остаётся независимым сигналом — состав карт меняется асинхронно,
   * в промежутке между пересчётами гейта, а коллайдеры строятся из ДАННЫХ
   * карты, не только из типа поверхности.
   */
  public get version(): number {
    return this.registryVersion
  }

  public get(path: string): HeightMapData | undefined {
    return this.maps.get(path)
  }

  /** Минимум высот (м): полная карта, иначе заголовок, иначе undefined. */
  public floorMeters(path: string): number | undefined {
    return this.maps.get(path)?.minMeters ?? this.headers.get(path)?.minMeters
  }

  /**
   * Параллельно, провалы — пропуск без броска: атмосфера без пола хуже, чем
   * без заголовка. Итог сводится в ОДИН warn — деградация (пол 0 у всех
   * перечисленных тел) видна с одного взгляда, а не собирается из N строк.
   */
  public async preloadHeaders(paths: readonly string[]): Promise<void> {
    const failed: string[] = []
    let firstCause: unknown

    await Promise.all(
      paths
        .filter((path: string) => !this.headers.has(path))
        .map(async (path: string) => {
          try {
            this.headers.set(path, await this.fetchHeader(path))
          } catch (cause) {
            failed.push(path)
            firstCause ??= cause
          }
        })
    )

    if (failed.length > 0) {
      console.warn(
        `[HeightFieldStorage] заголовки карт высот не прочитаны (${failed.length}): ${failed.join(', ')} — пол рельефа этих тел остаётся 0`,
        firstCause
      )
    }
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

  /**
   * Range-запрос на заголовок плюс отмена потока после первых байт: сервер,
   * игнорирующий Range, отдаст 200 с полным телом (64–128 МиБ) — читаем
   * только до HEIGHT_MAP_HEADER_BYTES и рвём соединение.
   */
  private async fetchHeader(path: string): Promise<HeightMapHeader> {
    const response = await fetch(Storage.url(path), { headers: { Range: `bytes=0-${HEIGHT_MAP_HEADER_BYTES - 1}` } })

    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)

    const reader = response.body.getReader()
    const head = new Uint8Array(HEIGHT_MAP_HEADER_BYTES)
    let filled = 0

    try {
      while (filled < HEIGHT_MAP_HEADER_BYTES) {
        const { done, value } = await reader.read()

        if (done) throw new Error(`тело короче заголовка (${filled} байт)`)

        const take = Math.min(value.byteLength, HEIGHT_MAP_HEADER_BYTES - filled)
        head.set(value.subarray(0, take), filled)
        filled += take
      }
    } finally {
      void reader.cancel().catch(() => undefined)
    }

    return parseHeightMapHeader(head.buffer)
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
