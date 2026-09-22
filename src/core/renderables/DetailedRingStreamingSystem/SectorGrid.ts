import { hashSectorKey, hashUnitOf } from './SeededRandom'
import { RadialDensityProfile } from './RadialDensityProfile'
import { triangularMass } from './triangularMass'

/** Размер LRU-кэша слоёв: пояс шириной 16 а.е. даёт ~1.2 млн слоёв, держать их все нельзя. */
const LAYER_CACHE_LIMIT = 64

/**
 * Описание границ одного сектора в полярных координатах
 */
interface SectorBounds {
  minRadius: number
  maxRadius: number
  minAngle: number
  maxAngle: number
  /** Границы ячейки по высоте, ring-local Y. Один вертикальный слой → вся толщина. */
  minY: number
  maxY: number
}

/**
 * Центр сектора в декартовых координатах кольца — ЕДИНЫЙ источник для сетки
 * (SectorInfo.centerX/centerY/centerZ) и для генератора, который вычитает этот
 * центр из позиций камней (relativeToSector). Обе стороны обязаны получить
 * побитово одно и то же число, иначе origin + local разъедется с абсолютной
 * позицией сектора.
 */
function sectorCenter(bounds: SectorBounds): { x: number; y: number; z: number } {
  const centerRadius = (bounds.minRadius + bounds.maxRadius) * 0.5
  const centerAngle = (bounds.minAngle + bounds.maxAngle) * 0.5

  return {
    x: Math.cos(centerAngle) * centerRadius,
    y: (bounds.minY + bounds.maxY) * 0.5,
    z: Math.sin(centerAngle) * centerRadius
  }
}

/**
 * Метаданные сектора
 */
interface SectorInfo {
  key: string
  layerIndex: number
  angleIndex: number
  /** Индекс вертикального слоя. У плоской сетки (verticalLayerCount 1) всегда 0. */
  yIndex: number
  bounds: SectorBounds
  centerRadius: number
  centerAngle: number
  centerX: number
  centerZ: number
  /** Y центра ячейки, ring-local. У плоской сетки — центр толщины (обычно 0). */
  centerY: number
  seed: number
  /** Приблизительный радиус bounding sphere сектора */
  boundingRadius: number
  /** Рекомендуемое количество экземпляров для сектора (пропорционально площади) */
  instanceCount: number
}

/**
 * Описание одного радиального слоя
 */
interface LayerInfo {
  index: number
  innerRadius: number
  outerRadius: number
  centerRadius: number
  angularSectorCount: number
  angularStep: number
}

/**
 * Конфигурация сетки секторов
 */
interface SectorGridConfig {
  innerRadius: number
  outerRadius: number
  cellSize: number
  ringId: number
  /** Базовая плотность экземпляров на единицу площади */
  densityPerUnit: number
  /**
   * Ниже порога 0.5 (см. getSectorInfo) считать instanceCount розыгрышем
   * Бернулли по хешу сектора вместо гарантированного 0. Дефолт false — старый
   * код колец побайтно (см. git show 2df9dfe); true задаёт только пояс
   * (AsteroidBelt.__createStreamer) — там 0 < weighted < 1 у большинства
   * секторов, и без розыгрыша разреженный пояс терял бы почти все камни.
   */
  stochasticCount?: boolean
  /**
   * Полная толщина сетки по Y, units сцены. Не задана — толщина 0, поэтому
   * сетка не может стать объёмной случайно: verticalLayerCount всегда 1
   * независимо от cellHeight — путь колец, третий индекс ключа не появляется.
   */
  heightExtent?: number
  /**
   * Высота ячейки, units сцены. Не задана или ≥ heightExtent → один слой на
   * всю толщину — путь колец: ключ без третьего индекса, высота не участвует
   * ни в метрике расстояния, ни в bounding sphere.
   */
  cellHeight?: number
}

/**
 * SectorGrid — полярная сетка, разбивающая кольцо на секторы.
 *
 * Кольцо делится на радиальные слои (по cellSize), каждый слой — на угловые секторы.
 * Количество угловых секторов в каждом слое адаптировано к длине окружности,
 * чтобы секторы были приблизительно одинаковой площади.
 *
 * Не создаёт Three.js объекты — чистая математика.
 */
class SectorGrid {
  public readonly config: SectorGridConfig
  public readonly layerCount: number
  private readonly layerThickness: number

  /** Число вертикальных слоёв. 1 — плоская сетка (кольцо), путь без третьего индекса ключа. */
  public readonly verticalLayerCount: number
  /** Слоёв больше одного — от этого зависят ключ сектора, метрика расстояния и bounding sphere. */
  public readonly volumetric: boolean
  /** Эффективная толщина сетки по Y, units сцены — 0 у плоской сетки (путь колец). */
  public readonly heightExtent: number
  /** Эффективная высота ячейки по Y — heightExtent / verticalLayerCount, а не запрошенное значение конфига. */
  public readonly cellHeight: number

  /** LRU по порядку вставки Map: старый ключ — первый в итерации, вытесняется первым. */
  private readonly layerCache = new Map<number, LayerInfo>()

  /**
   * Радиальный профиль плотности из альфы текстуры кольца (A-lite). null →
   * равномерная плотность. Устанавливается асинхронно, когда текстура готова
   * (см. AsteroidRingSystem), поэтому мутабельный.
   */
  private densityProfile: RadialDensityProfile | null = null

  public constructor(config: SectorGridConfig) {
    this.config = config
    const ringWidth = config.outerRadius - config.innerRadius
    this.layerCount = Math.max(1, Math.round(ringWidth / config.cellSize))
    this.layerThickness = ringWidth / this.layerCount

    this.heightExtent = config.heightExtent ?? 0
    const requestedCellHeight = config.cellHeight
    // Слоёв больше одного только когда явно запрошена положительная ячейка
    // меньше толщины — иначе (в т.ч. толщина 0, cellHeight не задан или ≤ 0)
    // ровно один слой, путь колец. Без проверки на > 0 ноль или отрицательное
    // значение дали бы verticalLayerCount = Infinity/NaN и нулевые секторы без ошибки.
    this.verticalLayerCount =
      this.heightExtent > 0 &&
      requestedCellHeight !== undefined &&
      requestedCellHeight > 0 &&
      requestedCellHeight < this.heightExtent
        ? Math.max(1, Math.round(this.heightExtent / requestedCellHeight))
        : 1
    this.volumetric = this.verticalLayerCount > 1
    this.cellHeight = this.heightExtent / this.verticalLayerCount
  }

  /**
   * Аналитическая оценка общего числа секторов пояса — эквивалент
   * layerCount × среднее число угловых секторов на слой (площадь тора /
   * площадь ячейки), без обхода самих слоёв. Только диагностика (debug stats,
   * см. AsteroidRingSystem.getDebugInfo) — может слегка отличаться от точного
   * счёта прежнего (не ленивого) прохода по всем слоям, в рендере не участвует.
   */
  public get totalSectorCount(): number {
    const { innerRadius, outerRadius, cellSize } = this.config

    return Math.round((Math.PI * (outerRadius * outerRadius - innerRadius * innerRadius)) / (cellSize * cellSize))
  }

  /**
   * Задать радиальный профиль плотности (взвешивает instanceCount секторов).
   * Пустотные полосы получают вес ~0 → instanceCount 0 → сектор не генерится.
   */
  public setDensityProfile(profile: RadialDensityProfile | null): void {
    this.densityProfile = profile
  }

  /**
   * Слой по индексу — вычисляется на лету (те же формулы, что были в buildLayers),
   * с LRU-кэшем на LAYER_CACHE_LIMIT слоёв: перебор окна вокруг камеры трогает
   * только соседние индексы, кэш покрывает это без пересчёта каждый кадр.
   */
  public layerAt(index: number): LayerInfo {
    if (index < 0 || index >= this.layerCount) {
      throw new RangeError(`SectorGrid.layerAt: индекс ${index} вне диапазона [0, ${this.layerCount})`)
    }

    const cached = this.layerCache.get(index)
    if (cached) {
      // Освежить позицию в порядке вставки — из неё LRU и вытесняет самый старый
      this.layerCache.delete(index)
      this.layerCache.set(index, cached)
      return cached
    }

    const { innerRadius, cellSize } = this.config
    const layerInner = innerRadius + index * this.layerThickness
    const layerOuter = layerInner + this.layerThickness
    const centerRadius = (layerInner + layerOuter) * 0.5
    const circumference = 2 * Math.PI * centerRadius
    const angularSectorCount = Math.max(6, Math.round(circumference / cellSize))
    const angularStep = (2 * Math.PI) / angularSectorCount

    const layer: LayerInfo = {
      index,
      innerRadius: layerInner,
      outerRadius: layerOuter,
      centerRadius,
      angularSectorCount,
      angularStep
    }

    this.layerCache.set(index, layer)
    if (this.layerCache.size > LAYER_CACHE_LIMIT) {
      // Map хранит порядок вставки — первый ключ в итерации самый старый
      const oldestKey = this.layerCache.keys().next().value
      if (oldestKey !== undefined) this.layerCache.delete(oldestKey)
    }

    return layer
  }

  /**
   * Возвращает информацию о секторе по ключу (layerIndex, angleIndex, yIndex).
   * yIndex обязателен — у плоской сетки единственный валидный индекс 0, но
   * дефолт-в-ноль на объёмной сетке молча подменял бы вызов нижним слоем.
   */
  public getSectorInfo(layerIndex: number, angleIndex: number, yIndex: number): SectorInfo {
    if (yIndex < 0 || yIndex >= this.verticalLayerCount) {
      throw new RangeError(
        `SectorGrid.getSectorInfo: индекс слоя по высоте ${yIndex} вне диапазона [0, ${this.verticalLayerCount})`
      )
    }

    const layer = this.layerAt(layerIndex)
    const normalizedAngleIndex =
      ((angleIndex % layer.angularSectorCount) + layer.angularSectorCount) % layer.angularSectorCount

    const minAngle = normalizedAngleIndex * layer.angularStep
    const maxAngle = (normalizedAngleIndex + 1) * layer.angularStep
    const centerAngle = (minAngle + maxAngle) * 0.5
    const centerRadius = layer.centerRadius

    const halfHeight = this.heightExtent * 0.5
    const minY = -halfHeight + yIndex * this.cellHeight
    const maxY = minY + this.cellHeight

    const bounds: SectorBounds = {
      minRadius: layer.innerRadius,
      maxRadius: layer.outerRadius,
      minAngle,
      maxAngle,
      minY,
      maxY
    }
    // Тот же способ, что у генератора (см. sectorCenter): centerRadius слоя —
    // это ровно (innerRadius + outerRadius) * 0.5 его границ
    const center = sectorCenter(bounds)

    // Bounding radius: половина диагонали ячейки. Высота входит только у
    // объёмной сетки — у плоской (кольца) сфера прежняя, диагональ без Y.
    const radialSpan = layer.outerRadius - layer.innerRadius
    const arcSpan = centerRadius * layer.angularStep
    const ySpan = this.volumetric ? this.cellHeight : 0
    const boundingRadius = Math.sqrt(radialSpan * radialSpan + arcSpan * arcSpan + ySpan * ySpan) * 0.5

    // Площадь сектора (annular sector area)
    const area =
      0.5 * (layer.outerRadius * layer.outerRadius - layer.innerRadius * layer.innerRadius) * layer.angularStep
    // A-lite: взвешиваем по альфе профиля на радиальной полосе слоя. Пустотные
    // слои (вес ~0) дают 0 → сектор не генерится вовсе (нет waste на пустотах).
    const weight = this.densityProfile
      ? this.densityProfile.weightForBand(layer.innerRadius, layer.outerRadius)
      : 1
    // Доля камней колонки, приходящаяся на эту ячейку по высоте. У плоской
    // сетки ячейка — вся колонка, вес единица: счёт колец не меняется
    const verticalWeight = this.volumetric ? triangularMass(minY, maxY, halfHeight) : 1
    const weighted = area * this.config.densityPerUnit * weight * verticalWeight

    // Ключ и сид несут третий индекс только у объёмной сетки — у плоской
    // (кольца) строка и сид побайтно те же, что до вертикальной оси.
    const key = this.volumetric
      ? `${layerIndex}_${normalizedAngleIndex}_${yIndex}`
      : `${layerIndex}_${normalizedAngleIndex}`
    // Угол и высота хешируются раздельно и объединяются xor — оба вклада
    // остаются в пределах uint32 при любом yIndex.
    const seed = this.volumetric
      ? (hashSectorKey(this.config.ringId, layerIndex, normalizedAngleIndex) ^
          Math.imul(yIndex + 1, 0x9e3779b1)) >>>
        0
      : hashSectorKey(this.config.ringId, layerIndex, normalizedAngleIndex)

    // 0.5 — прежний порог округления колец, не трогаем: выше него счёт побайтно
    // такой же, как раньше при любом флаге. Ниже — под stochasticCount (только
    // пояс, см. SectorGridConfig) разыгрывается по хешу сектора вместо
    // гарантированного 0; кольца (флаг выключен) идут прежней веткой
    const instanceCount =
      weighted >= 0.5
        ? Math.max(1, Math.round(weighted))
        : this.config.stochasticCount
          ? hashUnitOf(seed, 0x9e37) < weighted
            ? 1
            : 0
          : 0

    return {
      key,
      layerIndex,
      angleIndex: normalizedAngleIndex,
      yIndex,
      bounds,
      centerRadius,
      centerAngle,
      centerX: center.x,
      centerZ: center.z,
      centerY: center.y,
      seed,
      boundingRadius,
      instanceCount
    }
  }

  /**
   * Возвращает массив SectorInfo для всех секторов в окрестности заданной точки.
   * @param cameraAngle — угол камеры в полярных координатах (radians)
   * @param cameraRadius — расстояние камеры от центра кольца
   * @param cameraY — высота камеры, ring-local Y. У плоской сетки (volumetric
   * false) не влияет ни на окно, ни на метрику — только у объёмной. Значение
   * обязательно, чтобы вызывающий явно решал, средняя плоскость это или нет:
   * дефолт-в-ноль у объёмной сетки молча выбрал бы не то окно слоёв.
   * @param maxDistance — максимальное расстояние от камеры для включения сектора
   */
  public getSectorsInRange(
    cameraAngle: number,
    cameraRadius: number,
    cameraY: number,
    maxDistance: number
  ): SectorInfo[] {
    const result: SectorInfo[] = []
    const camX = Math.cos(cameraAngle) * cameraRadius
    const camZ = Math.sin(cameraAngle) * cameraRadius

    // Окно слоёв вокруг камеры по высоте — как и радиальное окно ниже: с запасом
    // в слой, точный отбор — фильтром внутри цикла. У плоской сетки один слой
    // (индекс 0) всегда в окне — путь колец не меняется.
    const halfHeight = this.heightExtent * 0.5
    const yLo = this.volumetric
      ? Math.max(0, Math.floor((cameraY - maxDistance + halfHeight) / this.cellHeight) - 1)
      : 0
    const yHi = this.volumetric
      ? Math.min(this.verticalLayerCount - 1, Math.ceil((cameraY + maxDistance + halfHeight) / this.cellHeight) + 1)
      : 0

    for (let yi = yLo; yi <= yHi; yi++) {
      if (this.volumetric) {
        const cellMinY = -halfHeight + yi * this.cellHeight
        const closestY = Math.max(cellMinY, Math.min(cellMinY + this.cellHeight, cameraY))
        // Точный отбор по высоте — окно выше надмножество, как у радиального
        if (Math.abs(closestY - cameraY) > maxDistance) continue
      }

      // Окно слоёв вокруг камеры по радиусу — вместо обхода всех layerCount слоёв пояса.
      // Надмножество (±1 слой) прежнего точного скана: если частное на границе целое,
      // floor/ceil сами по себе отрезают соседний слой, который старый код включал
      // (его radialDist == maxDistance проходил нестрогую проверку). Отсекает по-прежнему
      // фильтр radialDist > maxDistance внутри цикла — запас в 2 слоя за кадр бесплатен.
      const { innerRadius } = this.config
      const loIndex = Math.max(0, Math.floor((cameraRadius - maxDistance - innerRadius) / this.layerThickness) - 1)
      const hiIndex = Math.min(
        this.layerCount - 1,
        Math.ceil((cameraRadius + maxDistance - innerRadius) / this.layerThickness) + 1
      )

      for (let li = loIndex; li <= hiIndex; li++) {
        const layer = this.layerAt(li)
        // Быстрая проверка по радиусу: может ли хоть один сектор этого слоя быть в range
        const closestRadial = Math.max(layer.innerRadius, Math.min(layer.outerRadius, cameraRadius))
        const radialDist = Math.abs(closestRadial - cameraRadius)
        if (radialDist > maxDistance) continue

        // Определяем диапазон углов, которые могут попасть в range
        // На данном радиусе, arc = angle * radius, поэтому angle = maxDistance / radius
        const angularRange = maxDistance / layer.centerRadius
        const startAngle = cameraAngle - angularRange
        const endAngle = cameraAngle + angularRange

        const startIndex = Math.floor(startAngle / layer.angularStep)
        const endIndex = Math.ceil(endAngle / layer.angularStep)

        for (let ai = startIndex; ai <= endIndex; ai++) {
          const info = this.getSectorInfo(layer.index, ai, yi)

          // Точная проверка расстояния до центра сектора. dy входит только у
          // объёмной сетки — у плоской (кольца) метрика двумерная, как была.
          const dx = info.centerX - camX
          const dz = info.centerZ - camZ
          const dy = this.volumetric ? info.centerY - cameraY : 0
          const dist = Math.sqrt(dx * dx + dz * dz + dy * dy)

          if (dist - info.boundingRadius <= maxDistance) {
            result.push(info)
          }
        }
      }
    }

    return result
  }
}

export { SectorGrid, sectorCenter }
export type { SectorGridConfig, SectorBounds, SectorInfo, LayerInfo }
