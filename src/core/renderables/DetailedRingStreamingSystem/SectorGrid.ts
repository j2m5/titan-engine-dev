import { hashSectorKey } from './SeededRandom'

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
  public readonly layers: LayerInfo[]
  public readonly totalSectorCount: number

  public constructor(config: SectorGridConfig) {
    this.config = config
    this.layers = this.buildLayers()
    this.totalSectorCount = this.layers.reduce((sum, l) => sum + l.angularSectorCount, 0)
  }

  private buildLayers(): LayerInfo[] {
    const { innerRadius, outerRadius, cellSize } = this.config
    const ringWidth = outerRadius - innerRadius
    const layerCount = Math.max(1, Math.round(ringWidth / cellSize))
    const layerThickness = ringWidth / layerCount
    const layers: LayerInfo[] = []

    for (let i = 0; i < layerCount; i++) {
      const layerInner = innerRadius + i * layerThickness
      const layerOuter = layerInner + layerThickness
      const centerRadius = (layerInner + layerOuter) * 0.5
      const circumference = 2 * Math.PI * centerRadius
      const angularSectorCount = Math.max(6, Math.round(circumference / cellSize))
      const angularStep = (2 * Math.PI) / angularSectorCount

      layers.push({
        index: i,
        innerRadius: layerInner,
        outerRadius: layerOuter,
        centerRadius,
        angularSectorCount,
        angularStep
      })
    }

    return layers
  }

  /**
   * Возвращает информацию о секторе по ключу (layerIndex, angleIndex)
   */
  public getSectorInfo(layerIndex: number, angleIndex: number): SectorInfo {
    const layer = this.layers[layerIndex]
    const normalizedAngleIndex =
      ((angleIndex % layer.angularSectorCount) + layer.angularSectorCount) % layer.angularSectorCount

    const minAngle = normalizedAngleIndex * layer.angularStep
    const maxAngle = (normalizedAngleIndex + 1) * layer.angularStep
    const centerAngle = (minAngle + maxAngle) * 0.5
    const centerRadius = layer.centerRadius

    const centerX = Math.cos(centerAngle) * centerRadius
    const centerZ = Math.sin(centerAngle) * centerRadius

    // Bounding radius: половина диагонали сектора (грубая оценка)
    const radialSpan = layer.outerRadius - layer.innerRadius
    const arcSpan = centerRadius * layer.angularStep
    const boundingRadius = Math.sqrt(radialSpan * radialSpan + arcSpan * arcSpan) * 0.5

    // Площадь сектора (annular sector area)
    const area =
      0.5 * (layer.outerRadius * layer.outerRadius - layer.innerRadius * layer.innerRadius) * layer.angularStep
    const instanceCount = Math.max(1, Math.round(area * this.config.densityPerUnit))

    const key = `${layerIndex}_${normalizedAngleIndex}`
    const seed = hashSectorKey(this.config.ringId, layerIndex, normalizedAngleIndex)

    return {
      key,
      layerIndex,
      angleIndex: normalizedAngleIndex,
      bounds: {
        minRadius: layer.innerRadius,
        maxRadius: layer.outerRadius,
        minAngle,
        maxAngle
      },
      centerRadius,
      centerAngle,
      centerX,
      centerZ,
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

    for (const layer of this.layers) {
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

export { SectorGrid }
export type { SectorGridConfig, SectorBounds, SectorInfo, LayerInfo }
