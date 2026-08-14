import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { slopeNormalFunctions } from '@/core/materials/shaders/lib/chunks/SlopeNormal'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { SLOPE_RANGE } from '@/core/terrain/slopeMapFormat'

describe('SlopeNormal: попиксельная нормаль из slope-карты', () => {
  it('чанк зарегистрирован — иначе include молча раскроется в пустоту', () => {
    expect(AppShaderChunk.slopeNormalFunctions).toBe(slopeNormalFunctions)
  })

  it('одна выборка RG вместо четырёх выборок высот — мипы фильтруют уклоны сами', () => {
    expect(slopeNormalFunctions).toContain('texture2D(bumpMap, uv).xy')
    expect(slopeNormalFunctions).not.toContain('uBumpTexelSize')
  })

  it('декод знаковой кодировки зеркалит SLOPE_RANGE энкодера, а не свою копию константы', () => {
    expect(slopeNormalFunctions).toContain('* 255.0 - 128.0')
    // GLSL интерполирует общий SLOPE_RANGE: перекалибровка диапазона в одном
    // месте меняет и энкодер, и декод — рассинхрон невозможен
    expect(slopeNormalFunctions).toContain(`(${SLOPE_RANGE.toFixed(1)} / 127.0)`)
  })

  it('у полюса тангенс вырожден — возвращается геометрическая нормаль', () => {
    expect(slopeNormalFunctions).toContain('if (len < 1e-4) return surfNormal;')
  })

  it('шаблон ветвится: USE_SLOPE зовёт perturbNormalFromSlope, USE_BUMP не тронут', () => {
    expect(PlanetShaderTemplate.fragmentShader).toContain('#ifdef USE_SLOPE')
    expect(PlanetShaderTemplate.fragmentShader).toContain('perturbNormalFromSlope(normal, vEast, vUv)')
    expect(PlanetShaderTemplate.fragmentShader).toContain('perturbNormalFromHeight(normal, vEast, vUv)')
  })
})
