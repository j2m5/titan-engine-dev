import { PerspectiveCamera } from 'three'
import { BLOOM_OPTIONS, Postprocessing, readAtmosphereDebugView, TONE_MAPPING_OPTIONS } from '@/core/graphic/Postprocessing'
import { BlendFunction, Effect, EffectPass, RenderPass, ToneMappingMode } from 'postprocessing'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { AtmosphereEffect, createAtmospherePass } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { buildSlotGlsl } from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'

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
    expect(buildSlotGlsl(0)).toContain('min(scatter, vec3(1.0)) + excess * uSlot0_hdrKnee')
  })

  it('охват гало задан явно, а не унаследован от дефолта библиотеки', () => {
    // levels задаёт, докуда дотягивается гало: каждый уровень удваивает охват.
    // Дефолт библиотеки — 8, и РАВЕНСТВО ему неотличимо от молчаливой
    // зависимости: смена версии postprocessing поменяет вид картинки
    expect(BLOOM_OPTIONS.levels).toBeGreaterThan(8)
  })

  it('сила гало задана явно и положительна', () => {
    // Потеря intensity вернёт дефолт библиотеки 1.0 при зелёном прогоне
    expect(BLOOM_OPTIONS.intensity).toBeGreaterThan(0)
  })

  it('radius не выходит за 1: выше единицы блум ЗАТЕМНЯЕТ', () => {
    // radius — вес mix(резкий уровень, размытый нижний) в UpsamplingMaterial,
    // а не ширина фильтра. При radius > 1 это экстраполяция, и там, где резкий
    // уровень ярче размытого, SCREEN получает отрицательный вклад
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

  it('порядок пассов: атмосфера между RenderPass и HDR-проходом', () => {
    // Блум считает яркость по входу СВОЕГО пасса — он обязан видеть уже
    // затуманенный кадр, поэтому атмосфера идёт отдельным пассом раньше
    const passes = new Postprocessing(
      null as never,
      null as never,
      new PerspectiveCamera(),
      new AtmosphereRegistry()
    ).buildPasses()

    expect(passes).toHaveLength(4)
    expect(passes[0]).toBeInstanceOf(RenderPass)
    expect((passes[1] as unknown as { effects: Effect[] }).effects[0]).toBeInstanceOf(AtmosphereEffect)
    expect(passes[2]).toBeInstanceOf(EffectPass)
    expect(passes[3]).toBeInstanceOf(EffectPass)
  })
})

describe('Postprocessing: гало усилено, кромка диска мягче', () => {
  it('сила гало поднята выше прежних 1.4', () => {
    // Приёмка по картинке: диск звезды не должен читаться жёсткой границей.
    // Порог остаётся 1.0 — усиление идёт силой и весом размытых мипов
    expect(BLOOM_OPTIONS.intensity).toBeGreaterThanOrEqual(2.2)
  })

  it('вес размытых мипов поднят: гало наползает на кромку', () => {
    // radius — вес mix(резкий уровень, размытый нижний): ближе к 1 —
    // больше нижних мипов в наложении, мягче граница источника
    expect(BLOOM_OPTIONS.radius).toBeGreaterThanOrEqual(0.98)
    expect(BLOOM_OPTIONS.radius).toBeLessThanOrEqual(1)
  })
})
