import { hashSectorKey, hashUnitOf } from './SeededRandom'
import { RadialDensityProfile } from './RadialDensityProfile'

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
}

/**
 * Центр сектора в декартовых координатах кольца (XZ) — ЕДИНЫЙ источник для
 * сетки (SectorInfo.centerX/centerZ) и для генератора, который вычитает этот
 * центр из позиций камней (relativeToSector). Обе стороны обязаны получить
 * побитово одно и то же число, иначе origin + local разъедется с абсолютной
 * позицией сектора.
 */
function sectorCenter(bounds: SectorBounds): { x: number; z: number } {
  const centerRadius = (bounds.minRadius + bounds.maxRadius) * 0.5
  const centerAngle = (bounds.minAngle + bounds.maxAngle) * 0.5

  return { x: Math.cos(centerAngle) * centerRadius, z: Math.sin(centerAngle) * centerRadius }
}

/**
 * Метаданные сектора
 */
interface SectorInfo {
  key: string
  layerIndex: number
  angleIndex: number
  bounds: SectorBounds
  centerRadius: number
  centerAngle: number
  centerX: number
  centerZ: number
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
  }

  /**
   * Аналитическая оценка общего числа секторов пояса (площадь / площадь ячейки),
   * без обхода всех слоёв. Используется только диагностикой (debug stats) —
   * не совпадает с точной суммой на малом числе слоёв, но верна асимптотически.
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
   * Возвращает информацию о секторе по ключу (layerIndex, angleIndex)
   */
  public getSectorInfo(layerIndex: number, angleIndex: number): SectorInfo {
    const layer = this.layerAt(layerIndex)
    const normalizedAngleIndex =
      ((angleIndex % layer.angularSectorCount) + layer.angularSectorCount) % layer.angularSectorCount

    const minAngle = normalizedAngleIndex * layer.angularStep
    const maxAngle = (normalizedAngleIndex + 1) * layer.angularStep
    const centerAngle = (minAngle + maxAngle) * 0.5
    const centerRadius = layer.centerRadius

    const bounds: SectorBounds = {
      minRadius: layer.innerRadius,
      maxRadius: layer.outerRadius,
      minAngle,
      maxAngle
    }
    // Тот же способ, что у генератора (см. sectorCenter): centerRadius слоя —
    // это ровно (innerRadius + outerRadius) * 0.5 его границ
    const center = sectorCenter(bounds)

    // Bounding radius: половина диагонали сектора (грубая оценка)
    const radialSpan = layer.outerRadius - layer.innerRadius
    const arcSpan = centerRadius * layer.angularStep
    const boundingRadius = Math.sqrt(radialSpan * radialSpan + arcSpan * arcSpan) * 0.5

    // Площадь сектора (annular sector area)
    const area =
      0.5 * (layer.outerRadius * layer.outerRadius - layer.innerRadius * layer.innerRadius) * layer.angularStep
    // A-lite: взвешиваем по альфе профиля на радиальной полосе слоя. Пустотные
    // слои (вес ~0) дают 0 → сектор не генерится вовсе (нет waste на пустотах).
    const weight = this.densityProfile
      ? this.densityProfile.weightForBand(layer.innerRadius, layer.outerRadius)
      : 1
    const weighted = area * this.config.densityPerUnit * weight

    const key = `${layerIndex}_${normalizedAngleIndex}`
    const seed = hashSectorKey(this.config.ringId, layerIndex, normalizedAngleIndex)

    // 0.5 — прежний порог округления колец, не трогаем: выше него счёт побайтно
    // такой же, как раньше. Ниже — разреженный пояс, где < 0.5 камня на сектор
    // раньше давало гарантированный 0; теперь разыгрывается по хешу сектора
    const instanceCount =
      weighted >= 0.5 ? Math.max(1, Math.round(weighted)) : hashUnitOf(seed, 0x9e37) < weighted ? 1 : 0

    return {
      key,
      layerIndex,
      angleIndex: normalizedAngleIndex,
      bounds,
      centerRadius,
      centerAngle,
      centerX: center.x,
      centerZ: center.z,
      seed,
      boundingRadius,
      instanceCount
    }
  }

  /**
   * Возвращает массив SectorInfo для всех секторов в окрестности заданной точки.
   * @param cameraAngle — угол камеры в полярных координатах (radians)
   * @param cameraRadius — расстояние камеры от центра кольца
   * @param maxDistance — максимальное расстояние от камеры для включения сектора
   */
  public getSectorsInRange(cameraAngle: number, cameraRadius: number, maxDistance: number): SectorInfo[] {
    const result: SectorInfo[] = []
    const camX = Math.cos(cameraAngle) * cameraRadius
    const camZ = Math.sin(cameraAngle) * cameraRadius

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
        const info = this.getSectorInfo(layer.index, ai)

        // Точная проверка расстояния до центра сектора
        const dx = info.centerX - camX
        const dz = info.centerZ - camZ
        const dist = Math.sqrt(dx * dx + dz * dz)

        if (dist - info.boundingRadius <= maxDistance) {
          result.push(info)
        }
      }
    }

    return result
  }
}

export { SectorGrid, sectorCenter }
export type { SectorGridConfig, SectorBounds, SectorInfo, LayerInfo }
