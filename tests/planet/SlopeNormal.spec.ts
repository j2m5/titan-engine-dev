import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { slopeNormalFunctions } from '@/core/materials/shaders/lib/chunks/SlopeNormal'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('SlopeNormal: попиксельная нормаль из slope-карты', () => {
  it('чанк зарегистрирован — иначе include молча раскроется в пустоту', () => {
    expect(AppShaderChunk.slopeNormalFunctions).toBe(slopeNormalFunctions)
  })

  it('одна выборка RG вместо четырёх выборок высот — мипы фильтруют уклоны сами', () => {
    expect(slopeNormalFunctions).toContain('texture2D(bumpMap, uv).xy')
    expect(slopeNormalFunctions).not.toContain('uBumpTexelSize')
  })

  it('декод знаковой кодировки: байт 128 — нулевой уклон, диапазон ±2', () => {
    expect(slopeNormalFunctions).toContain('* 255.0 - 128.0')
    expect(slopeNormalFunctions).toContain('(2.0 / 127.0)')
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
