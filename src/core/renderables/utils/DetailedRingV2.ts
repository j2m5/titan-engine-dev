import { Group } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { degToRad, randFloat } from 'three/src/math/MathUtils'
import { AsteroidCluster } from '@/core/renderables/utils/AsteroidCluster'

class DetailedRingV2 extends Group {
  public model: Actor

  private readonly innerRadius: number
  private readonly outerRadius: number
  private readonly countInstances: number

  private readonly cellRadius: number
  private readonly ringThickness: number
  private readonly radialPadding: number = 0.8

  public constructor(model: Actor) {
    super()
    this.model = model

    this.innerRadius = this.model.renderingObject?.getAttribute('data').innerRadius
    this.outerRadius = this.model.renderingObject?.getAttribute('data').outerRadius
    this.countInstances = this.model.renderingObject?.getAttribute('data').countParticles

    this.cellRadius = toThreeJSUnits(2000)
    this.ringThickness = 0.3

    this.__setup()
  }

  public __setup(): void {
    const ringWidth = toThreeJSUnits(this.outerRadius) - toThreeJSUnits(this.innerRadius)
    const cellDiameter = this.cellRadius * 2 * this.radialPadding

    const radialLayers = Math.floor(ringWidth / cellDiameter)
    if (radialLayers <= 0 || this.countInstances <= 0) return

    // --------------------------------------------------
    // 1️⃣ Сначала описываем ВСЕ возможные ячейки кольца
    // --------------------------------------------------
    type CellDesc = {
      radius: number
      theta: number
    }

    const cells: CellDesc[] = []

    for (let layer = 0; layer < radialLayers; layer++) {
      const radius =
        toThreeJSUnits(this.innerRadius) +
        cellDiameter * (layer + 0.5) +
        randFloat(-this.cellRadius * 0.4, this.cellRadius * 0.4)

      const circumference = Math.PI * 2 * radius
      const cellsInLayer = Math.max(6, Math.floor(circumference / cellDiameter))

      for (let i = 0; i < cellsInLayer; i++) {
        const theta =
          (i / cellsInLayer) * Math.PI * 2 +
          randFloat((-Math.PI / cellsInLayer) * 0.35, (Math.PI / cellsInLayer) * 0.35)
        cells.push({ radius, theta })
      }
    }

    if (cells.length === 0) return

    // --------------------------------------------------
    // 2️⃣ Определяем среднюю плотность (НЕ лимит!)
    // --------------------------------------------------
    const avgInstancesPerCell = this.countInstances / cells.length

    let remainingInstances = this.countInstances

    // --------------------------------------------------
    // 3️⃣ Создаём только нужные RingCell
    // --------------------------------------------------
    for (const cellDesc of cells) {
      if (remainingInstances <= 0) break

      const targetCount = Math.max(1, Math.round(avgInstancesPerCell * randFloat(0.65, 1.35)))

      const instanceCount = Math.min(targetCount, remainingInstances)

      remainingInstances -= instanceCount

      const cell = new AsteroidCluster(instanceCount, this.cellRadius, this.ringThickness)

      const x = Math.cos(cellDesc.theta) * cellDesc.radius
      const z = Math.sin(cellDesc.theta) * cellDesc.radius

      cell.position.set(x, 0, z)
      cell.rotation.y = cellDesc.theta

      this.add(cell)
    }
    this.rotateX(degToRad(90))
  }
}

export { DetailedRingV2 }
