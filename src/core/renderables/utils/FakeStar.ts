import { AdditiveBlending, BufferGeometry, Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { threeJS } from '@/core/graphic/ThreeJS'
import { degToRad } from 'three/src/math/MathUtils'
import { colorTemperatureToRGB, rgbToHex } from '@/core/materials/shaders/lib/helpers'
import { UpdateContext } from '@/core/UpdateContext'

/**
 * Объект созданный в качестве LOD-Level-2 для звездного меша
 * представляет собой псевдо-спрайт лишенный недостатков оригинального спрайта Three.js,
 * но наполненный собственными магическими числами и вычислениями, подстроенными под текущий рендер-пайплайн
 * так что по итогу назначение этого объекта только одно, см выше
 * не использовать для чего-то другого кроме как LOD-утилиту для сверх-ярких источников света
 */

class FakeStar extends Mesh {
  public model: Actor
  declare public geometry: BufferGeometry
  declare public material: MeshStandardMaterial

  private readonly scaleFactor: number

  public constructor(model: Actor, scaleFactor: number = 1) {
    super()
    this.model = model
    this.scaleFactor = scaleFactor

    this.__setup()
  }

  __setup(): void {
    const map: Texture = resourceStorage.getTexture('round.png')!
    const temperature = this.model.physicalObject?.getAttribute('temperature', 5700)
    const correctedTemperature = temperature + 1300
    const rgb = colorTemperatureToRGB(correctedTemperature)
    const color = rgbToHex(rgb)

    this.geometry = new PlaneGeometry(1, 1)
    this.material = new MeshStandardMaterial({
      map,
      blending: AdditiveBlending,
      emissive: color,
      emissiveIntensity: 40
    })

    this.scale.multiplyScalar(this.scaleFactor)
  }

  public updateObject(ctx: UpdateContext): void {
    this.lookAt(threeJS.camera.position)

    const distance = this.position.distanceTo(threeJS.camera.position)
    const fov = degToRad(threeJS.camera.fov)
    const height = 2 * Math.tan(fov / 2) * distance
    const pixels = height / threeJS.renderer.domElement.height

    const countPixels = 12
    const size = countPixels * pixels

    this.scale.setScalar(size * this.scaleFactor)
  }
}

export { FakeStar }
