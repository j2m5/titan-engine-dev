import { IGalaxyRenderStrategy } from '@/core/renderables/galaxy/IGalaxyRenderStrategy'
import { BufferAttribute, BufferGeometry, Color, Object3D, Points, Vector3 } from 'three'
import { AbstractShaderMaterial } from '@/core/materials/AbstractShaderMaterial'
import { GalaxyHaze } from '@/core/renderables/galaxy/utils/GalaxyHaze'
import { GalaxyMaterial } from '@/core/materials/GalaxyMaterial'
import {
  generateArms,
  generateInnerCore,
  generateOuterCore,
  NUM_STARS,
  spectralColors
} from '@/core/renderables/galaxy/utils'

class GalaxyStateStrategy implements IGalaxyRenderStrategy {
  private readonly geometry: BufferGeometry
  private readonly material: AbstractShaderMaterial
  private readonly haze: GalaxyHaze

  public constructor() {
    this.geometry = new BufferGeometry()
    this.material = new GalaxyMaterial()
    this.haze = new GalaxyHaze()
  }

  public build(): Object3D {
    const points: Vector3[] = [
      ...generateInnerCore(NUM_STARS),
      ...generateOuterCore(NUM_STARS),
      ...generateArms(NUM_STARS)
    ]
    const positions: Float32Array = new Float32Array(points.length * 3)
    const colors: Float32Array = new Float32Array(points.length * 3)

    for (let i: number = 0, j: number = 0; i < points.length; i++, j += 3) {
      const color: Color = new Color(this.getRandomColor())

      positions[j] = points[i].x
      positions[j + 1] = points[i].y
      positions[j + 2] = points[i].z

      colors[j] = color.r
      colors[j + 1] = color.g
      colors[j + 2] = color.b
    }

    this.geometry.setAttribute('position', new BufferAttribute(positions, 3))
    this.geometry.setAttribute('color', new BufferAttribute(colors, 3))

    const galaxy: Object3D = new Points(this.geometry, this.material)

    galaxy.add(this.haze.build())

    return galaxy
  }

  public update(delta?: number): void {
    this.haze.update()
  }

  private getRandomColor(): number {
    return spectralColors[Math.floor(Math.random() * spectralColors.length)]
  }
}

export { GalaxyStateStrategy }
