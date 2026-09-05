import { describe, expect, it } from 'vitest'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

const frag: string = PlanetShaderTemplate.fragmentShader

/**
 * Терминатор суши считается по геометрической (радиальной) нормали сферы,
 * рельеф — только ламбертом с полом. Иначе обратный склон на дневной стороне
 * уходил в ветку «ночь» = ровно 0, и terrainAmbient до него не доезжал.
 */
describe('PlanetShaderTemplate: терминатор суши по геометрической нормали', () => {
  it('в терраформной ветке угол солнца для терминатора берётся из vNormal, не из рельефной normal', () => {
    const block = frag.slice(frag.indexOf('float terminatorNdotL'), frag.indexOf('float dayFactor'))

    expect(block).toContain('#ifdef USE_TERRAIN_UV')
    expect(block).toContain('terminatorNdotL = sunElevation;')
    // sunElevation — геометрический угол солнца, объявлен до ламберта и до терминатора
    const sunIdx = frag.indexOf('float sunElevation = dot(normalize(vNormal), lightDirection);')
    expect(sunIdx).toBeGreaterThan(-1)
    expect(sunIdx).toBeLessThan(frag.indexOf('float ambientFloor'))
    expect(sunIdx).toBeLessThan(frag.indexOf('float terminatorNdotL'))
  })

  it('dayFactor и nightGate используют terminatorNdotL, ламберт рельефа — NdotLraw', () => {
    expect(frag).toContain('float dayFactor = smoothstep(-0.08, 0.25, terminatorNdotL);')
    expect(frag).toContain('float nightGate = 1.0 - smoothstep(-0.05, 0.12, terminatorNdotL);')
    expect(frag).toContain('mix(ambientFloor, 1.0, max(NdotLraw, 0.0))')
  })

  it('пол ламберта ∝ солнцу над геометрическим горизонтом: полный при sunElevation ≥ uTerrainAmbientSunRef, ноль на терминаторе', () => {
    expect(frag).toContain(
      'float ambientFloor = uTerrainAmbient * clamp(sunElevation / max(uTerrainAmbientSunRef, 1e-3), 0.0, 1.0);'
    )
    expect(frag).toContain('uniform float uTerrainAmbientSunRef;')
    expect(PlanetShaderTemplate.uniforms.uTerrainAmbientSunRef.value).toBe(0.3)
  })

  // Дефолт PlanetShader пинит tests/planet/TerrainLambert.spec.ts (со стабом текстур)
  it('дефолт пола ламберта 0.15 в шаблоне', () => {
    expect(PlanetShaderTemplate.uniforms.uTerrainAmbient.value).toBe(0.15)
  })
})
