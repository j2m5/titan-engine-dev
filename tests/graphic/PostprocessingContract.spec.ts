import { BLOOM_OPTIONS, TONE_MAPPING_OPTIONS } from '@/core/graphic/Postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { BrunetonAtmosphereShaderTemplate } from '@/core/renderables/Atmosphere/BrunetonAtmosphereShaderTemplate'

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
    // Диффуз-композит < порога bloom; HDR-глинт добавляется после клампа
    // и ограничен потолком 4.0 (блумит только солнечная дорожка)
    // Порядок (кламп до блика) закреплён индексным тестом в tests/planet/PlanetShaderTemplate.spec.ts
    expect(PlanetShaderTemplate.fragmentShader).toContain('clamp(finalColor, 0.0, 0.99)')
    expect(PlanetShaderTemplate.fragmentShader).toContain('min(finalColor, vec3(4.0))')
    expect(BLOOM_OPTIONS.luminanceThreshold).toBeGreaterThan(0.99)
  })

  it('bloom считается в SCREEN-бленде до тонмапа (HDR-источники)', () => {
    expect(BLOOM_OPTIONS.blendFunction).toBe(BlendFunction.SCREEN)
    expect(BLOOM_OPTIONS.luminanceThreshold).toBe(1)
  })

  it('колено атмосферы калибровано на порог bloom 1.0 — при смене порога пересмотреть колено', () => {
    expect(BLOOM_OPTIONS.luminanceThreshold).toBe(1)
    expect(BrunetonAtmosphereShaderTemplate.fragmentShader).toContain('min(color, vec3(1.0)) + excess * uHdrKnee')
  })

  it('охват гало задан явно, а не унаследован от дефолта библиотеки', () => {
    // levels задаёт, докуда дотягивается гало: каждый уровень удваивает охват.
    // Дефолт библиотеки — 8; молчаливая зависимость от него означает, что смена
    // версии postprocessing поменяет вид картинки
    expect(BLOOM_OPTIONS.levels).toBeDefined()
    expect(BLOOM_OPTIONS.levels).toBeGreaterThanOrEqual(8)
  })

  it('порог блума не тронут настройкой гало', () => {
    // Ширина и сила гало меняются, а порог остаётся частью bloom-guard:
    // он связан с клампом планет 0.99 и с порогом блика объектива
    expect(BLOOM_OPTIONS.luminanceThreshold).toBe(1)
  })
})
