import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Sprite,
  SpriteMaterial,
  Vector3
} from 'three'
import { IRenderable } from '@/core/renderables/IRenderable'
import { resourceStorage } from '@/core/services/ResourceStorage'
import {
  generateArms,
  generateInnerCore,
  generateOuterCore,
  GALAXY_MEAN_RADIUS,
  HAZE_COLOR_CENTER,
  HAZE_COLOR_MID,
  HAZE_COLOR_EDGE,
  HAZE_MIN,
  HAZE_MAX,
  HAZE_OPACITY,
  HAZE_RATIO,
  HAZE_THICKNESS
} from '@/core/renderables/galaxy/utils'
import { clamp } from 'three/src/math/MathUtils'
import { threeJS } from '@/core/graphic/ThreeJS'

const v: Vector3 = new Vector3()

class GalaxyHaze implements IRenderable {
  public material: SpriteMaterial
  public object3D: Object3D
  private readonly discGeometry: CircleGeometry
  private readonly discMaterial: MeshBasicMaterial
  private readonly disc3D: Object3D
  private materials: SpriteMaterial[] = []

  public constructor() {
    this.material = new SpriteMaterial({
      map: resourceStorage.getTexture('sun_glow.png'),
      color: '#ffd192',
      opacity: HAZE_OPACITY,
      depthTest: false,
      depthWrite: false
    })
    this.object3D = new Group()
    this.discGeometry = new CircleGeometry(GALAXY_MEAN_RADIUS * 2)
    this.discMaterial = new MeshBasicMaterial({
      map: resourceStorage.getTexture('galaxy.png'),
      color: '#c4dbf1',
      transparent: true,
      opacity: 0.4,
      side: DoubleSide
    })
    this.disc3D = new Mesh(this.discGeometry, this.discMaterial)
  }

  public build(): Object3D {
    const points: Vector3[] = [
      ...generateInnerCore(HAZE_THICKNESS * HAZE_RATIO),
      ...generateOuterCore(HAZE_THICKNESS * HAZE_RATIO),
      ...generateArms(HAZE_THICKNESS * HAZE_RATIO)
    ]

    let color: Color = new Color()
    for (let i: number = 0; i < points.length; i++) {
      const sprite: Sprite = new Sprite(this.material.clone())
      const radius: number = Math.sqrt(points[i].x ** 2 + points[i].y ** 2)
      const theta: number = clamp(radius / GALAXY_MEAN_RADIUS, 0, 1)

      if (theta < 0.5) {
        const theta2: number = theta / 0.5

        color = HAZE_COLOR_CENTER.clone().lerp(HAZE_COLOR_MID, theta2)
      } else {
        const theta2: number = (theta - 0.5) / 0.5

        color = HAZE_COLOR_MID.clone().lerp(HAZE_COLOR_EDGE, theta2)
      }

      sprite.material.color.copy(color)
      this.materials.push(sprite.material)

      sprite.position.set(points[i].x, points[i].y, points[i].z)
      sprite.scale.multiplyScalar(clamp(HAZE_MAX * Math.random(), HAZE_MIN, HAZE_MAX))

      this.object3D.add(sprite)
    }

    this.object3D.add(this.disc3D)

    return this.object3D
  }

  public update(): void {
    const distance: number = this.object3D.getWorldPosition(v).distanceTo(threeJS.camera.position) / 250
    this.materials.forEach((material: SpriteMaterial): void => {
      material.opacity = clamp(HAZE_OPACITY * Math.pow(distance / 2.5, 2), 0, HAZE_OPACITY)
    })
    this.discMaterial.opacity = clamp(0.2 * Math.pow(distance / 2.5, 2), 0, 0.4)
  }
}

export { GalaxyHaze }
