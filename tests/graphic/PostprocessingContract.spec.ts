import { BLOOM_OPTIONS, TONE_MAPPING_OPTIONS } from '@/core/graphic/Postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'

describe('Postprocessing: контракт цветового конвейера', () => {
  it('тонмаппинг реально применяется: NORMAL-бленд, не DST-заглушка', () => {
    // DST означал «взять то, что было до эффекта» — результат тонмапа выбрасывался
    expect(TONE_MAPPING_OPTIONS.blendFunction).toBe(BlendFunction.NORMAL)
    expect(TONE_MAPPING_OPTIONS.blendFunction).not.toBe(BlendFunction.DST)
  })

  it('режим тонмаппинга — AgX', () => {
    expect(TONE_MAPPING_OPTIONS.mode).toBe(ToneMappingMode.AGX)
  })

  it('bloom-guard: кламп планеты 0.99 остаётся НИЖЕ порога bloom', () => {
    // Осознанное решение владельца: планеты не должны блумить.
    // Кламп 0.99 в шейдере планеты + порог bloom 1.0 образуют пару-инвариант.
    expect(PlanetShaderTemplate.fragmentShader).toContain('clamp(vec4(finalColor, 1.0), 0.0, 0.99)')
    expect(BLOOM_OPTIONS.luminanceThreshold).toBeGreaterThan(0.99)
  })

  it('bloom считается в SCREEN-бленде до тонмапа (HDR-источники)', () => {
    expect(BLOOM_OPTIONS.blendFunction).toBe(BlendFunction.SCREEN)
    expect(BLOOM_OPTIONS.luminanceThreshold).toBe(1)
  })
})
