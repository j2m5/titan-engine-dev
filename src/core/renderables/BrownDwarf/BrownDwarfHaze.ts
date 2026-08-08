import { AdditiveBlending, BufferGeometry, FrontSide, Mesh, ShaderMaterial, SphereGeometry, UniformsUtils } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { BrownDwarfHazeShaderTemplate } from '@/core/renderables/BrownDwarf/BrownDwarfHazeShaderTemplate'
import { brownDwarfParameters, BrownDwarfParameters, BROWN_DWARF_PALETTE_SPREAD_K } from '@/core/renderables/BrownDwarf/BrownDwarfParameters'
import { buildStarPalette, StarPalette } from '@/core/materials/shaders/lib/helpers'

/** Оболочка дымки относительно тела: тонкий слой на просвет у кромки */
export const HAZE_RADIUS_SCALE: number = 1.03

/**
 * Длина хорды луча внутри оболочки, в радиусах тела. mu — косинус (нормаль, луч на камеру)
 *
 * CPU-зеркало формулы из BrownDwarfHazeShaderTemplate — менять строго
 * синхронно, числовой тест проверяет только эту сторону.
 */
export function hazeChord(mu: number): number {
  const sin2: number = Math.max(0, 1 - mu * mu)
  const outer: number = Math.sqrt(Math.max(0, HAZE_RADIUS_SCALE * HAZE_RADIUS_SCALE - sin2))
  const inner: number = Math.sqrt(Math.max(0, 1 - sin2))

  return outer - inner
}

/**
 * Дымка над лимбом карлика: тонкая сферическая оболочка чуть больше тела.
 * Скользящий луч у кромки пересекает больше вещества оболочки, чем луч
 * в центре диска, — отсюда свечение кольцом по лимбу.
 *
 * Живёт только на ближнем LOD: висит на теле (body.add), а не на узле.
 */
class BrownDwarfHaze extends Mesh {
  declare public geometry: BufferGeometry
  declare public material: ShaderMaterial

  public constructor(model: Actor) {
    super()

    const radius: number = toThreeJSUnits(model.physicalObject?.getAttribute('radius') ?? 0)
    const params: BrownDwarfParameters = brownDwarfParameters(model)
    const palette: StarPalette = buildStarPalette(params.temperature, BROWN_DWARF_PALETTE_SPREAD_K)

    this.geometry = new SphereGeometry(radius * HAZE_RADIUS_SCALE, 64, 64)
    this.material = new ShaderMaterial({
      vertexShader: BrownDwarfHazeShaderTemplate.vertexShader,
      fragmentShader: BrownDwarfHazeShaderTemplate.fragmentShader,
      uniforms: UniformsUtils.clone(BrownDwarfHazeShaderTemplate.uniforms),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: FrontSide
    })

    this.material.uniforms.uColor.value.setRGB(palette.hot.r, palette.hot.g, palette.hot.b)
    this.material.uniforms.uStrength.value = params.hazeStrength
    this.material.uniforms.uShellScale.value = HAZE_RADIUS_SCALE
  }
}

export { BrownDwarfHaze }
