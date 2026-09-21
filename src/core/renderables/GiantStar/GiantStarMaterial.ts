import { ShaderMaterial, UniformsUtils } from 'three'
import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { GiantStarShaderTemplate } from '@/core/renderables/GiantStar/GiantStarShaderTemplate'
import {
  GiantStarParameters,
  giantStarCellEnergy,
  giantStarIntensity
} from '@/core/renderables/GiantStar/GiantStarParameters'
import { buildStarPalette, planckX, StarPalette } from '@/core/materials/shaders/lib/helpers'

/** Сдвиг домена на единицу seed: некратен периоду шума */
const SEED_DOMAIN_STEP: number = 17.31

/**
 * Материал фотосферы. Юниформы клонируются — температура пер-объектная.
 * Палитра, энергия ячеек, лимб и яркость — функции одной температуры:
 * развести их между собой нельзя по построению.
 */
class GiantStarMaterial extends ShaderMaterial {
  public constructor(params: GiantStarParameters) {
    super({
      vertexShader: AbstractShader.prepareSource(GiantStarShaderTemplate.vertexShader),
      fragmentShader: AbstractShader.prepareSource(GiantStarShaderTemplate.fragmentShader),
      uniforms: UniformsUtils.clone(GiantStarShaderTemplate.uniforms)
    })

    const palette: StarPalette = buildStarPalette(params.temperature, params.spreadK)

    this.uniforms.uColorCool.value.setRGB(palette.cool.r, palette.cool.g, palette.cool.b)
    this.uniforms.uColorBase.value.setRGB(palette.base.r, palette.base.g, palette.base.b)
    this.uniforms.uColorHot.value.setRGB(palette.hot.r, palette.hot.g, palette.hot.b)
    this.uniforms.uCellEnergy.value.fromArray(giantStarCellEnergy(params.temperature, params.spreadK))
    this.uniforms.uPlanckX.value.fromArray(planckX(params.temperature))
    this.uniforms.uCoreIntensity.value = giantStarIntensity(params)
    this.uniforms.uCellCount.value = params.cellCount
    this.uniforms.uSeed.value = params.seed * SEED_DOMAIN_STEP
  }
}

export { GiantStarMaterial, SEED_DOMAIN_STEP }
