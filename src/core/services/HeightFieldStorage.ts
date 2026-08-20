import { Storage } from '@/core/framework/file/Storage'
import { config } from '@/core/framework/config'
import { parseHeightMap, type HeightMapData } from '@/core/terrain/heightMapFormat'
import {
  parseTerrainAux,
  terrainAuxMismatch,
  terrainAuxPathFor,
  type TerrainAuxData,
  type TerrainAuxPayload
} from '@/core/terrain/terrainAuxFormat'

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
 *
 * Вместе с картой едет её КОМПАНЬОН (`terrainAuxFormat`) — запечённое
 * производное состояние поля высот. Без него конструктор `TerrainHeightField`
 * считает сетку провиса и обе пирамиды сам: ~870 мс на карте 8192×4096,
 * синхронно, в том самом кадре, где спросовый режим её и запрашивает — то
 * есть ровно на подлёте к телу. С компаньоном тот же конструктор стоит
 * сотые доли миллисекунды. Компаньон — ускорение, а не данные: его отсутствие
 * или расхождение с картой роняет скорость, но не корректность (см. fetchAuxData/acceptAux).
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
    const auxPath: string = terrainAuxPathFor(path)

    try {
      // Оба запроса стартуют РАЗОМ: компаньон не нужен для разбора карты, и
      // последовательные ожидания добавили бы к появлению рельефа лишний
      // round-trip. Карта первой — порядок обращений остаётся читаемым в
      // сетевой панели и закреплён тестом.
      const mapPending: Promise<Response> = fetch(Storage.url(path))
      const auxPending: Promise<TerrainAuxData | null> = this.fetchAuxData(auxPath)

      const response = await mapPending

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const map: HeightMapData = parseHeightMap(await response.arrayBuffer())
      const aux: TerrainAuxPayload | undefined = this.acceptAux(await auxPending, map, auxPath)

      if (epoch !== this.epoch) return

      // Карта публикуется ОДНОЙ записью, уже с компаньоном: поле высот
      // кешируется по ссылке на карту (terrainHeightFieldFor), и публикация
      // «сначала карта, компаньон потом» означала бы поле, посчитанное
      // вручную и закешированное на весь сеанс — тот самый фриз, ради выноса
      // которого компаньон и заведён.
      this.maps.set(path, aux ? { ...map, aux } : map)
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

  /**
   * Компаньон карты (`terrainAuxFormat`) — запечённое производное состояние
   * поля высот: сетка провиса, ε-пирамида, пирамида максимумов узлов. С ним
   * конструктор `TerrainHeightField` только присваивает поля; без него он
   * считает их сам — порядка секунды на карте 8192×4096, синхронно, в кадре.
   *
   * НИКОГДА не бросает: компаньон — ускорение, а не данные. Любая беда с ним
   * (нет файла, битый контейнер, отпечаток или калибровка не сошлись) даёт
   * `undefined` и предупреждение, карта доезжает и работает как раньше.
   * Молчать здесь нельзя: тихий фолбэк вернул бы секунду счёта в кадр, и
   * единственным следом остался бы подлагивающий подлёт.
   */
  private async fetchAuxData(auxPath: string): Promise<TerrainAuxData | null> {
    try {
      const response = await fetch(Storage.url(auxPath))

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      return parseTerrainAux(await response.arrayBuffer())
    } catch (cause) {
      this.warnAuxUnused(auxPath, cause)

      return null
    }
  }

  /**
   * Смысловая сверка компаньона с картой: разбор выше проверяет только
   * структуру контейнера, а «тот ли это компаньон и той ли модели» знает
   * `terrainAuxMismatch` — и знать может лишь тот, у кого карта на руках.
   */
  private acceptAux(
    aux: TerrainAuxData | null,
    map: HeightMapData,
    auxPath: string
  ): TerrainAuxPayload | undefined {
    if (!aux) return undefined

    const mismatch: string | null = terrainAuxMismatch(aux, map)

    if (!mismatch) return aux

    this.warnAuxUnused(auxPath, new Error(mismatch))

    return undefined
  }

  /**
   * Причина — В САМОМ сообщении, а не только в `cause`: «протух по отпечатку»
   * и «не залит на сервер» лечатся по-разному, а в консоли видно первую строку.
   */
  private warnAuxUnused(auxPath: string, cause: unknown): void {
    const reason: string = cause instanceof Error ? cause.message : String(cause)

    console.warn(
      `[HeightFieldStorage] компаньон ${auxPath} не использован (${reason}) — блоки будут посчитаны в рантайме`,
      cause
    )
  }
}

export const heightFieldStorage = new HeightFieldStorage()
