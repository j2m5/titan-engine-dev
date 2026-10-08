import { HalfFloatType, PerspectiveCamera, TextureLoader, UnsignedByteType, WebGLRenderTarget, type WebGLRenderer } from 'three'
import type { Mock } from 'vitest'
import { BLOOM_OPTIONS, createEffectPasses } from '@/core/graphic/Postprocessing'
import { LensFlareEffect, lensFlareEffectOptionsDefaults } from '@/core/graphic/effects/lensflare/LensFlareEffect'
import { FLARE_GHOSTS } from '@/core/graphic/effects/lensflare/flareGhosts'
import { LOCAL_CONTRAST_RADIUS, contrastRadiusPixels } from '@/core/graphic/effects/lensflare/flareGrid'
import { glslFloat } from '@/core/graphic/effects/lensflare/glslLiteral'
import { lensFlare } from '@/config/lensFlare'

/** Мок рендерера: интересна последовательность setRenderTarget; очистка и её цвет нужны спрайтам */
const createRendererStub = (): { setRenderTarget: Mock; render: Mock; clear: Mock } & Record<string, unknown> => ({
  setRenderTarget: vi.fn(),
  render: vi.fn(),
  clear: vi.fn(),
  getClearColor: vi.fn((target: unknown) => target),
  getClearAlpha: vi.fn(() => 0),
  setClearColor: vi.fn(),
  autoClear: true,
  getRenderTarget: vi.fn(() => null),
  getContext: vi.fn(() => ({}))
})

/**
 * Адреса записи ИМЕННО в таргеты эффекта, по порядку. Внутренние таргеты
 * KawaseBlurPass сюда не попадают: это чужие объекты, их число зависит от ядра
 */
const writeSequence = (effect: LensFlareEffect, renderer: { setRenderTarget: Mock }): unknown[] => {
  const own: unknown[] = [
    effect.renderTarget1,
    effect.renderTarget2,
    effect.streakSourceTarget,
    effect.streakTarget,
    effect.gridFluxTarget,
    effect.gridCentroidTarget,
    effect.sourceFluxTarget,
    effect.sourceCentroidTarget,
    effect.ghostTarget
  ]
  return renderer.setRenderTarget.mock.calls.map(([target]) => target).filter((target) => own.includes(target))
}

const runUpdate = (effect: LensFlareEffect): ReturnType<typeof createRendererStub> => {
  const renderer = createRendererStub()
  effect.update(renderer as unknown as WebGLRenderer, new WebGLRenderTarget(8, 8))
  return renderer
}

describe('LensFlareEffect: контракт блика объектива', () => {
  it('свечением владеет BloomEffect: своей копии блума у эффекта нет', () => {
    const effect = new LensFlareEffect()

    expect(effect.getFragmentShader()).not.toContain('bloomBuffer')
    expect('blurPass' in effect).toBe(false)
  })

  it('дефолт яркости — значение конфига: калибровки спрайтов рассчитаны на него', () => {
    expect(lensFlareEffectOptionsDefaults.intensity).toBe(lensFlare.lensFlare.intensity)
  })

  it('порог берётся у bloom, а не своей копией числа', () => {
    const effect = new LensFlareEffect({ thresholdLevel: BLOOM_OPTIONS.luminanceThreshold })

    expect(effect.thresholdLevel).toBe(BLOOM_OPTIONS.luminanceThreshold)
  })

  it('ручки доезжают до юниформов композита и спрайтов', () => {
    const effect = new LensFlareEffect({
      intensity: 0.2,
      ghostAmount: 0.7,
      ghostVignette: 3,
      ghostChromatic: 0.05
    })

    expect(effect.uniforms.get('intensity').value).toBe(0.2)
    expect(effect.uniforms.get('ghostAmount').value).toBe(0.7)
    expect(effect.ghostMaterial.ghostVignette).toBe(3)
    expect(effect.ghostMaterial.ghostChromatic).toBe(0.05)
  })
})

describe('LensFlareEffect: композит', () => {
  it('множители призраков и штриха — в композите: устаревшие буферы при пропуске умножаются на ноль', () => {
    const source = new LensFlareEffect().getFragmentShader()

    expect(source).toContain('texture(ghostBuffer, uv).rgb * ghostAmount')
    expect(source).toContain('texture(streakBuffer, uv).rgb * streakAmount')
    expect(source).toContain('outputColor = vec4(inputColor.rgb + flare * intensity, inputColor.a);')
  })

  it('лучей starburst нет: ни буфера в композите, ни прохода, ни ручек', () => {
    const effect = new LensFlareEffect()

    expect(effect.getFragmentShader()).not.toContain('starburst')
    expect(effect.uniforms.has('starburstBuffer')).toBe(false)
    expect('starburstMaterial' in effect).toBe(false)
    for (const key of ['starburstAmount', 'starburstMinFlux']) {
      expect(key in lensFlare.lensFlare).toBe(false)
    }
  })

  it('композит читает призраков из ghostTarget, штрих из streakTarget', () => {
    const effect = new LensFlareEffect()

    expect(effect.uniforms.get('ghostBuffer').value).toBe(effect.ghostTarget.texture)
    expect(effect.uniforms.get('streakBuffer').value).toBe(effect.streakTarget.texture)
  })

  it('призраки делят с композитом сами объекты Uniform', () => {
    const effect = new LensFlareEffect()

    expect(effect.ghostMaterial.uniforms.ghostAmount).toBe(effect.uniforms.get('ghostAmount'))
    expect(effect.ghostMaterial.uniforms.intensity).toBe(effect.uniforms.get('intensity'))
  })

  it('призраки читают выбранные источники', () => {
    const effect = new LensFlareEffect()

    expect(effect.ghostMaterial.uniforms.sourceFlux.value).toBe(effect.sourceFluxTarget.texture)
    expect(effect.ghostMaterial.uniforms.sourceCentroid.value).toBe(effect.sourceCentroidTarget.texture)
  })

  it('PNG объектива больше не грузятся', () => {
    const loadSpy = vi.spyOn(TextureLoader.prototype, 'load')
    const effect = new LensFlareEffect()
    const urls = loadSpy.mock.calls.map(([url]) => String(url))

    expect(urls.some((url) => url.includes('lenscolor.png') || url.includes('lensstar.png'))).toBe(false)

    loadSpy.mockRestore()
    effect.dispose()
  })
})

describe('LensFlareEffect: порядок проходов и адреса записи', () => {
  // Проверять вход прохода недостаточно: его выставляет сам ShaderPass.render.
  // Единственный наблюдаемый след порядка — последовательность setRenderTarget
  it('проходы идут в фиксированном порядке, каждый в свой таргет', () => {
    const effect = new LensFlareEffect({ streakAmount: lensFlare.lensFlare.streakAmount })
    const renderer = runUpdate(effect)

    expect(writeSequence(effect, renderer)).toEqual([
      effect.renderTarget1, // 1. порог и даунсэмпл
      effect.renderTarget2, // 2. предразмытие Kawase SMALL
      effect.streakSourceTarget, // 3. источник штриха
      effect.streakTarget, // 4. штрих
      effect.renderTarget1, // 5. локальный контраст
      effect.gridFluxTarget, // 6. сбор потока
      effect.gridCentroidTarget, // 7. сбор центров
      effect.sourceFluxTarget, // 8. отбор: поток
      effect.sourceCentroidTarget, // 9. отбор: центр
      effect.ghostTarget // 10. призраки
    ])
  })

  it('сбор читает локальный контраст, отбор — поток и центры сетки', () => {
    const effect = new LensFlareEffect()
    runUpdate(effect)

    expect(effect.gridFluxMaterial.uniforms.inputBuffer.value).toBe(effect.renderTarget1.texture)
    expect(effect.gridCentroidMaterial.uniforms.inputBuffer.value).toBe(effect.renderTarget1.texture)
    // Сырой поток — вход локального контраста: предразмытие в renderTarget2
    expect(effect.gridCentroidMaterial.uniforms.rawBuffer.value).toBe(effect.renderTarget2.texture)
    expect(effect.selectFluxMaterial.uniforms.inputBuffer.value).toBe(effect.gridFluxTarget.texture)
    expect(effect.selectFluxMaterial.uniforms.centroidBuffer.value).toBe(effect.gridCentroidTarget.texture)
    expect(effect.selectCentroidMaterial.uniforms.centroidBuffer.value).toBe(effect.gridCentroidTarget.texture)
  })

  it('призраки пишутся в очищенный таргет', () => {
    const effect = new LensFlareEffect()
    const renderer = runUpdate(effect)

    expect(renderer.clear).toHaveBeenCalledTimes(1)
    expect(renderer.clear).toHaveBeenCalledWith(true, false, false)
  })
})

describe('LensFlareEffect: пропуск проходов', () => {
  it('нулевой штрих — оба его прохода не выполняются', () => {
    const effect = new LensFlareEffect({ streakAmount: 0 })
    const written = writeSequence(effect, runUpdate(effect))

    expect(written).not.toContain(effect.streakSourceTarget)
    expect(written).not.toContain(effect.streakTarget)
  })

  it('нулевые призраки — сетка, отбор и спрайты не выполняются', () => {
    const effect = new LensFlareEffect({ ghostAmount: 0, streakAmount: 0 })
    const renderer = runUpdate(effect)

    expect(writeSequence(effect, renderer)).toEqual([effect.renderTarget1, effect.renderTarget2, effect.renderTarget1])
    expect(renderer.clear).not.toHaveBeenCalled()
  })
})

describe('LensFlareEffect: ресайз', () => {
  it('сетка, таргеты и инстансы следуют за кадром 16:9', () => {
    const effect = new LensFlareEffect()
    effect.setSize(1920, 1080)

    expect(effect.gridSize).toEqual({ cols: 64, rows: 36 })
    expect(effect.gridFluxTarget.width).toBe(64)
    expect(effect.sourceCentroidTarget.height).toBe(36)
    expect(effect.ghostTarget.width).toBe(480)
    expect(effect.ghostTarget.height).toBe(270)
    expect(effect.ghostGeometry.instanceCount).toBe(64 * 36 * FLARE_GHOSTS.length)
    expect(effect.ghostMaterial.uniforms.aspect.value).toBeCloseTo(16 / 9, 12)
    expect(effect.gridFluxMaterial.uniforms.areaPerTexel.value).toBeCloseTo(1 / 540 ** 2, 15)
    // Буфер 540 строк: радиус контраста 8 текселей = 16 px 1080p
    expect(effect.ghostMaterial.uniforms.contrastPixels.value).toBe(contrastRadiusPixels(540))
  })

  it('ресайз: сетка и инстансы следуют за аспектом без пересборки', () => {
    const effect = new LensFlareEffect()
    effect.setSize(1920, 1080)
    effect.setSize(2560, 1080)

    expect(effect.gridSize.cols).toBe(86)
    expect(effect.gridCentroidTarget.width).toBe(86)
    expect(effect.ghostGeometry.instanceCount).toBe(86 * 36 * FLARE_GHOSTS.length)
    expect(effect.ghostMaterial.uniforms.aspect.value).toBeCloseTo(2560 / 1080, 12)
  })

  it('нулевой кадр: аспект конечен, сетка конечна', () => {
    const effect = new LensFlareEffect()
    effect.setSize(0, 0)

    expect(Number.isFinite(effect.ghostMaterial.uniforms.aspect.value)).toBe(true)
    expect(effect.gridSize.cols).toBeGreaterThanOrEqual(1)
  })
})

describe('LensFlareEffect: анаморфный штрих', () => {
  it('штрих читает собственный источник — понижение предразмытого буфера', () => {
    const effect = new LensFlareEffect({ streakAmount: 0.03 })
    runUpdate(effect)

    expect(effect.streakMaterial.inputBuffer).toBe(effect.streakSourceTarget.texture)
    expect(effect.streakMaterial.inputBuffer).not.toBe(effect.renderTarget2.texture)
  })

  it('таргеты штриха — четверть базового разрешения', () => {
    const effect = new LensFlareEffect()
    effect.setSize(1024, 512)

    expect(effect.streakTarget.width).toBe(256)
    expect(effect.streakTarget.height).toBe(128)
    expect(effect.streakSourceTarget.width).toBe(256)
    expect(effect.streakMaterial.uniforms.texelSize.value.x).toBeCloseTo(1 / 256, 10)
  })

  it('ручки штриха доезжают из конфига', () => {
    const effect = new LensFlareEffect({
      streakAmount: lensFlare.lensFlare.streakAmount,
      streakThreshold: lensFlare.lensFlare.streakThreshold,
      streakScale: lensFlare.lensFlare.streakScale,
      streakTint: lensFlare.lensFlare.streakTint,
      streakSourceCeiling: lensFlare.lensFlare.streakSourceCeiling
    })

    expect(effect.streakAmount).toBe(lensFlare.lensFlare.streakAmount)
    expect(effect.streakMaterial.streakThreshold).toBe(lensFlare.lensFlare.streakThreshold)
    expect(effect.streakMaterial.streakScale).toBe(lensFlare.lensFlare.streakScale)
    expect(effect.streakMaterial.streakTint.toArray()).toEqual([...lensFlare.lensFlare.streakTint])
    expect(effect.streakMaterial.streakSourceCeiling).toBe(lensFlare.lensFlare.streakSourceCeiling)
  })

  it('тинт применяется один раз — в проходе, не в композите', () => {
    expect(new LensFlareEffect().getFragmentShader()).not.toContain('streakTint')
  })

  it('шейдер штриха зажимает яркость перед записью в half-float', () => {
    expect(new LensFlareEffect().streakMaterial.fragmentShader).toContain('min(total * streakTint, vec3(60000.0))')
  })
})

describe('LensFlareEffect: потолок яркости источника штриха', () => {
  const HALF_SAMPLES = 64
  const TARGET_CLAMP = 60000
  /** Rec. 709 — те же коэффициенты, что вставляет пролог three в luminance() */
  const luminance = (c: readonly [number, number, number]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

  /** CPU-зеркало накопления штриха для РОВНОЙ области яркости */
  const streakForFlatField = (
    color: readonly [number, number, number],
    threshold: number,
    tint: readonly [number, number, number],
    sourceCeiling: number
  ): number[] => {
    const raw = luminance(color)
    const limited = Math.min(raw, sourceCeiling)
    const scaled = color.map((c) => (c * limited) / Math.max(raw, 1e-6))

    return scaled.map((c, i) => Math.min(c * Math.max(limited - threshold, 0) * HALF_SAMPLES * tint[i], TARGET_CLAMP))
  }

  const WHITE_TINT = [1, 1, 1] as const
  /** Sirius B: wdShade упирается в потолок HDR 64 во всех трёх каналах */
  const SIRIUS_B = [64, 64, 64] as const
  /** Обычная звезда: starEnergy максимум 3.0 * STAR_CORE_INTENSITY 4.0 */
  const STAR = [12, 11, 10] as const

  it('без потолка яркость белого карлика насыщает таргет штриха', () => {
    expect(streakForFlatField(SIRIUS_B, 0.3, WHITE_TINT, Infinity).every((c) => c === TARGET_CLAMP)).toBe(true)
  })

  it('потолок 16 уводит карлика из насыщения', () => {
    expect(streakForFlatField(SIRIUS_B, 0.3, WHITE_TINT, 16).every((c) => c < TARGET_CLAMP)).toBe(true)
  })

  it('источник выше потолка даёт ровно то же, что источник НА потолке', () => {
    const atCeiling = streakForFlatField([16, 16, 16], 0.3, WHITE_TINT, 16)
    const wayAbove = streakForFlatField(SIRIUS_B, 0.3, WHITE_TINT, 16)

    wayAbove.forEach((value, i) => expect(value).toBeCloseTo(atCeiling[i], 6))
  })

  it('ниже потолка не меняется ничего', () => {
    const before = streakForFlatField(STAR, 0.3, WHITE_TINT, Infinity)
    const after = streakForFlatField(STAR, 0.3, WHITE_TINT, 16)

    after.forEach((value, i) => expect(value).toBeCloseTo(before[i], 6))
  })

  it('оттенок источника сохраняется', () => {
    const g2938 = [25.3, 31.5, 47.9] as const
    const limited = streakForFlatField(g2938, 0.3, WHITE_TINT, 16)

    expect(limited[2] / limited[0]).toBeCloseTo(g2938[2] / g2938[0], 6)
  })

  it('нулевой потолок гасит штрих', () => {
    expect(streakForFlatField(SIRIUS_B, 0.3, WHITE_TINT, 0)).toEqual([0, 0, 0])
  })

  it('шейдер ограничивает ЯРКОСТЬ источника до гейта', () => {
    const source = new LensFlareEffect().streakMaterial.fragmentShader

    expect(source).toContain('uniform float streakSourceCeiling;')
    expect(source).toContain('float limited = min(rawLuma, streakSourceCeiling);')
    expect(source).toContain('max(limited - streakThreshold, 0.0)')
  })

  it('потолок закреплён ниже точки насыщения и выше рабочих сцен', () => {
    expect(lensFlare.lensFlare.streakSourceCeiling).toBeLessThan(31)
    expect(lensFlare.lensFlare.streakSourceCeiling).toBeGreaterThanOrEqual(16)
  })
})

describe('LensFlareEffect: локальный контраст', () => {
  it('локальный контраст читает предразмытый буфер и следует за ресайзом', () => {
    const effect = new LensFlareEffect()
    runUpdate(effect)
    effect.setSize(1024, 512)

    expect(effect.localContrastMaterial.inputBuffer).toBe(effect.renderTarget2.texture)
    expect(effect.localContrastMaterial.uniforms.texelSize.value.x).toBeCloseTo(1 / 512, 10)
    expect(effect.localContrastMaterial.uniforms.texelSize.value.y).toBeCloseTo(1 / 256, 10)
  })

  it('радиус окрестности — константа из TS: им же меряется размер источника', () => {
    expect(new LensFlareEffect().localContrastMaterial.fragmentShader).toContain(
      `#define LOCAL_CONTRAST_RADIUS ${glslFloat(LOCAL_CONTRAST_RADIUS)}`
    )
  })
})

describe('LensFlareEffect: инициализация проходов', () => {
  it('источник штриха получает тип кадрового буфера', () => {
    const effect = new LensFlareEffect()
    const internals = effect.streakSourcePass as unknown as { renderTargetA: WebGLRenderTarget; renderTargetB: WebGLRenderTarget }

    expect(internals.renderTargetA.texture.type).toBe(UnsignedByteType)
    effect.initialize(createRendererStub() as unknown as WebGLRenderer, false, HalfFloatType)
    expect(internals.renderTargetA.texture.type).toBe(HalfFloatType)
    expect(internals.renderTargetB.texture.type).toBe(HalfFloatType)
  })

  it('initialize доходит до всех полноэкранных проходов', () => {
    const effect = new LensFlareEffect()
    effect.initialize(createRendererStub() as unknown as WebGLRenderer, false, HalfFloatType)

    for (const material of [
      effect.thresholdMaterial,
      effect.localContrastMaterial,
      effect.streakMaterial,
      effect.gridFluxMaterial,
      effect.gridCentroidMaterial,
      effect.selectFluxMaterial,
      effect.selectCentroidMaterial
    ]) {
      expect(material.defines.FRAMEBUFFER_PRECISION_HIGH).toBe('1')
    }
  })
})

describe('LensFlareEffect: разборка ресурсов', () => {
  it('таргеты, материал и геометрия призраков освобождаются штатным dispose', () => {
    // Effect.dispose() обходит Object.keys(this) и разбирает Texture/Material/
    // WebGLRenderTarget/Pass; геометрия в этот список не входит — её
    // освобождает переопределение dispose
    const effect = new LensFlareEffect()
    const disposed = vi.fn()
    for (const target of [effect.gridFluxTarget, effect.sourceCentroidTarget, effect.ghostTarget, effect.streakTarget]) {
      target.addEventListener('dispose', disposed)
    }
    const ghostGeometry = vi.spyOn(effect.ghostGeometry, 'dispose')
    const ghostMaterial = vi.spyOn(effect.ghostMaterial, 'dispose')
    const streakSourcePass = vi.spyOn(effect.streakSourcePass, 'dispose')

    effect.dispose()

    expect(disposed).toHaveBeenCalledTimes(4)
    expect(ghostGeometry).toHaveBeenCalled()
    expect(ghostMaterial).toHaveBeenCalled()
    expect(streakSourcePass).toHaveBeenCalled()
  })
})

describe('LensFlareEffect: значения приёмки', () => {
  it('интенсивность закреплена на значении, выбранном владельцем', () => {
    // 0.1 — выбранная ненавязчивость с учётом star.farGlowGain
    expect(lensFlare.lensFlare.intensity).toBe(0.1)
  })

  it('стартовые значения призраков — по расчёту, не замер', () => {
    expect(lensFlare.lensFlare.ghostAmount).toBe(1)
    expect(lensFlare.lensFlare.ghostVignette).toBe(2)
    expect(lensFlare.lensFlare.ghostChromatic).toBe(1)
  })

  it('ручек Чепмена больше нет', () => {
    for (const key of ['haloAmount', 'ghostThreshold', 'ghostAttenuation', 'chromaticAberration']) {
      expect(key in lensFlare.lensFlare).toBe(false)
    }
  })

  it('дефолты штриха закреплены: сила принята владельцем, остальные — стартовая точка', () => {
    expect(lensFlare.lensFlare.streakAmount).toBe(0.005)
    expect(lensFlare.lensFlare.streakThreshold).toBe(0.3)
    expect(lensFlare.lensFlare.streakScale).toBe(5)
    expect(lensFlare.lensFlare.streakTint).toEqual([0.15, 0.1, 1.0])
  })
})

describe('createEffectPasses: ручки блика из конфига', () => {
  it('доезжают до собранного эффекта', () => {
    const [hdrPass] = createEffectPasses(new PerspectiveCamera())
    const effects = (hdrPass as unknown as { effects: unknown[] }).effects
    const effect = effects.find((e): e is LensFlareEffect => e instanceof LensFlareEffect)!
    const cfg = lensFlare.lensFlare

    expect(effect.intensity).toBe(cfg.intensity)
    expect(effect.ghostAmount).toBe(cfg.ghostAmount)
    expect(effect.ghostVignette).toBe(cfg.ghostVignette)
    expect(effect.ghostChromatic).toBe(cfg.ghostChromatic)
    expect(effect.streakAmount).toBe(cfg.streakAmount)
    expect(effect.thresholdLevel).toBe(BLOOM_OPTIONS.luminanceThreshold)
  })
})
