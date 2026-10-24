import { PerspectiveCamera } from 'three'
import {
  BLOOM_OPTIONS,
  Postprocessing,
  readAtmosphereDebugView,
  TONE_MAPPING_OPTIONS
} from '@/core/graphic/Postprocessing'
import { BlendFunction, Effect, EffectPass, RenderPass, ToneMappingMode } from 'postprocessing'
import { SphereSurfaceShaderTemplate } from '@/core/materials/shaders/lib/SphereSurfaceShaderTemplate'
import { TerrainShaderTemplate } from '@/core/materials/shaders/lib/TerrainShaderTemplate'
import { AtmosphereEffect, createAtmospherePass } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { buildSlotGlsl } from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { DepthVolumePass } from '@/core/graphic/passes/DepthVolumePass'
import { GravitationalLensEffect } from '@/core/graphic/effects/lens/GravitationalLensEffect'
import { BlackHolePass } from '@/core/graphic/passes/BlackHolePass'
import { OverlayPass } from '@/core/graphic/passes/OverlayPass'
import { LensFrontSplitPass } from '@/core/graphic/passes/LensFrontSplitPass'
import { LensFrontPass } from '@/core/graphic/passes/LensFrontPass'

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
    // Порядок (кламп до блика) закреплён индексным тестом в tests/planet/PlanetSurfaceTemplates.spec.ts
    for (const template of [SphereSurfaceShaderTemplate, TerrainShaderTemplate]) {
      expect(template.fragmentShader).toContain('clamp(finalColor, 0.0, 0.99)')
      expect(template.fragmentShader).toContain('min(finalColor, vec3(4.0))')
    }
    expect(BLOOM_OPTIONS.luminanceThreshold).toBeGreaterThan(0.99)
  })

  it('колено атмосферы калибровано на порог bloom 1.0 — при смене порога пересмотреть колено', () => {
    expect(BLOOM_OPTIONS.luminanceThreshold).toBe(1)
    expect(buildSlotGlsl(0)).toContain('min(scatter, vec3(1.0)) + excess * uSlot0_hdrKnee')
  })

  it('сила гало задана явно и положительна', () => {
    // Потеря intensity вернёт дефолт библиотеки 1.0 при зелёном прогоне
    expect(BLOOM_OPTIONS.intensity).toBeGreaterThan(0)
  })

  it('radius не выходит за 1: экстраполяция может дать отрицательный свет', () => {
    // radius — вес mix(резкий уровень, размытый нижний) в UpsamplingMaterial,
    // а не ширина фильтра. При radius > 1 это экстраполяция, и там, где резкий
    // уровень ярче размытого, bloom получает отрицательный вклад
    expect(BLOOM_OPTIONS.radius).toBeGreaterThan(0)
    expect(BLOOM_OPTIONS.radius).toBeLessThanOrEqual(1)
  })

  it('порог блума не тронут настройкой гало', () => {
    // Ширина и сила гало меняются, а порог остаётся частью bloom-guard:
    // он связан с клампом планет 0.99 и с порогом блика объектива
    expect(BLOOM_OPTIONS.luminanceThreshold).toBe(1)
  })
})

describe('Postprocessing: пасс атмосферы', () => {
  it('readAtmosphereDebugView: 1..4 принимаются, прочее — 0', () => {
    expect(readAtmosphereDebugView('?atmoDebug=4')).toBe(4)
    expect(readAtmosphereDebugView('?atmoDebug=0')).toBe(0)
    expect(readAtmosphereDebugView('?atmoDebug=7')).toBe(0)
    expect(readAtmosphereDebugView('?atmoDebug=abc')).toBe(0)
    expect(readAtmosphereDebugView('')).toBe(0)
  })

  it('пасс атмосферы — отдельный EffectPass с единственным эффектом DEPTH', () => {
    const pass = createAtmospherePass(new PerspectiveCamera(), new AtmosphereRegistry(), 0)
    expect(pass).toBeInstanceOf(EffectPass)
    const effects = (pass as unknown as { effects: Effect[] }).effects
    expect(effects).toHaveLength(1)
    expect(effects[0]).toBeInstanceOf(AtmosphereEffect)

    // needsDepthTexture выводится при сборке материала; в приложении её делает
    // composer.addPass → pass.initialize, здесь — явный recompile
    pass.recompile()
    expect(pass.needsDepthTexture).toBe(true)
  })

  it('порядок пассов: пыль колец сразу за RenderPass, атмосфера перед HDR-проходом', () => {
    // Гало пыли режет марш по глубине сцены — ему нужен готовый depth-буфер,
    // поэтому оно идёт сразу за RenderPass и рисует в тот же буфер (без swap).
    // Атмосфера — за ним: она тонирует и пыль, а блум считает яркость по входу
    // СВОЕГО пасса и обязан видеть уже затуманенный кадр
    const passes = new Postprocessing(
      { domElement: document.createElement('canvas') } as never,
      null as never,
      new PerspectiveCamera(),
      new AtmosphereRegistry(),
      new DepthVolumeRegistry()
    ).buildPasses()

    expect(passes).toHaveLength(10)
    // Разметка прозрачного перед линзой — до основного прохода
    expect(passes[0]).toBeInstanceOf(LensFrontSplitPass)
    expect(passes[1]).toBeInstanceOf(RenderPass)
    expect(passes[2]).toBeInstanceOf(DepthVolumePass)
    // Меш дыры — за объёмами (сэмплирует кадр с ними), линза — следом; затем
    // прозрачное перед линзой и поверх всего — оверлеи (линии орбит), иначе
    // линия уходила бы под кольцо переднего тела; всё — до атмосферы
    expect(passes[3]).toBeInstanceOf(BlackHolePass)
    expect((passes[4] as unknown as { effects: Effect[] }).effects[0]).toBeInstanceOf(GravitationalLensEffect)
    // Слой неба общий: рисует BlackHolePass, читает дальнее поле линзы
    const lensEffect = (passes[4] as unknown as { effects: GravitationalLensEffect[] }).effects[0]
    expect(lensEffect.skyLayer).toBe((passes[3] as BlackHolePass).skyLayer)
    expect(passes[5]).toBeInstanceOf(LensFrontPass)
    expect(passes[6]).toBeInstanceOf(OverlayPass)
    expect((passes[7] as unknown as { effects: Effect[] }).effects[0]).toBeInstanceOf(AtmosphereEffect)
    expect(passes[8]).toBeInstanceOf(EffectPass)
    expect(passes[9]).toBeInstanceOf(EffectPass)

    // Один сортировщик на разметку, объёмы и отрисовку
    const sorterOf = (pass: unknown): unknown =>
      (pass as { sorter?: unknown }).sorter ?? (pass as { front?: unknown }).front
    expect(sorterOf(passes[0])).toBeDefined()
    expect(sorterOf(passes[2])).toBe(sorterOf(passes[0]))
    expect(sorterOf(passes[5])).toBe(sorterOf(passes[0]))
  })
})
