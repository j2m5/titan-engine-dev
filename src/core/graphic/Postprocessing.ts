import { HalfFloatType, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three'
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode
} from 'postprocessing'
import { LensFlareEffect } from '@/core/graphic/effects/lensflare/LensFlareEffect'
import { ExposureEffect } from '@/core/graphic/effects/grading/ExposureEffect'
import { ColorGradeEffect } from '@/core/graphic/effects/grading/ColorGradeEffect'
import { DitheringEffect } from '@/core/graphic/effects/dithering/DitheringEffect'
import { config } from '@/core/framework/config'

// Опции эффектов вынесены в константы под контракт-тесты
// (tests/graphic/PostprocessingContract.spec.ts).
// Инвариант bloom-guard: luminanceThreshold (1.0) обязан оставаться ВЫШЕ
// LDR-клампа планеты (0.99, PlanetShaderTemplate) — диффуз-композит планеты
// остаётся ниже порога и не блумит. Но HDR-глинт океана добавляется ПОСЛЕ
// клампа (см. PlanetShaderTemplate) и блумит намеренно. Честные HDR-источники:
// звёзды, диск ЧД, туманности, глинт.
export const BLOOM_OPTIONS = {
  radius: 0.9,
  blendFunction: BlendFunction.SCREEN,
  mipmapBlur: true,
  luminanceThreshold: 1,
  luminanceSmoothing: 0.0025,
  intensity: 1
} as const

// A/B-сравнение кривой: заменить mode на ToneMappingMode.ACES_FILMIC
export const TONE_MAPPING_OPTIONS = {
  mode: ToneMappingMode.AGX,
  blendFunction: BlendFunction.NORMAL
} as const

/**
 * Порядок эффектов в проходах — несущий, поэтому вынесен в константы.
 *
 * Константы совпадают с ФАКТИЧЕСКОЙ сборкой пасса, но не задают её:
 * `EffectPass.setEffects` пересортировывает эффекты по убыванию `attributes`,
 * и `LensFlareEffect` (CONVOLUTION) уезжает в начало независимо от аргументов.
 * Проверять порядок можно только на собранном пассе — см. тесты
 * tests/graphic/GradingContract.spec.ts.
 *
 * Экспозиция стоит ПОСЛЕ блума не ради порога: `EffectPass.render` зовёт
 * `update` каждого эффекта по входному таргету всего пасса, поэтому
 * `BloomEffect` считает свой luminancePass по кадру ДО пасса при любом порядке.
 * Причина в другом: текстура блума сгенерирована из неэкспонированного входа,
 * и экспозиция перед блумом отмасштабировала бы базу, но не наложение — база
 * и свечение разъехались бы по яркости.
 *
 * Дизеринг всегда последний: после него только квантование в канвас.
 */
export const HDR_EFFECT_ORDER = ['lensFlare', 'bloom', 'exposure', 'toneMapping'] as const
export const LDR_EFFECT_ORDER = ['chromaticAberration', 'colorGrade', 'dithering'] as const

/**
 * Сборка эффектных проходов. Вынесена из `initialize()` намеренно: конструктор
 * `EffectPass` не требует WebGLRenderer, поэтому тесты порядка и проводки
 * ручек читают СОБРАННЫЙ пасс, а не константы и не свои копии эффектов.
 */
export function createEffectPasses(camera: PerspectiveCamera): readonly [EffectPass, EffectPass] {
  const bloomEffect: BloomEffect = new BloomEffect({ ...BLOOM_OPTIONS })

  const lensFlareEffect: LensFlareEffect = new LensFlareEffect({
    camera,
    intensity: config('lensFlare.intensity'),
    ghostAmount: config('lensFlare.ghostAmount'),
    ghostThreshold: config('lensFlare.ghostThreshold'),
    ghostAttenuation: config('lensFlare.ghostAttenuation'),
    haloAmount: config('lensFlare.haloAmount'),
    chromaticAberration: config('lensFlare.chromaticAberration'),
    starburstAmount: config('lensFlare.starburstAmount'),
    streakAmount: config('lensFlare.streakAmount'),
    streakThreshold: config('lensFlare.streakThreshold'),
    streakScale: config('lensFlare.streakScale'),
    streakTint: config('lensFlare.streakTint'),
    // порог — общий с bloom: два разных числа разъехались бы при первой правке
    thresholdLevel: BLOOM_OPTIONS.luminanceThreshold
  })

  const exposureEffect: ExposureEffect = new ExposureEffect({
    exposure: config('grading.exposure'),
    temperature: config('grading.temperature'),
    tint: config('grading.tint')
  })

  const chromaticAberrationEffect: ChromaticAberrationEffect = new ChromaticAberrationEffect({
    blendFunction: BlendFunction.SCREEN,
    offset: new Vector2(0.0005, 0.0005),
    radialModulation: true,
    modulationOffset: 0.4
  })

  const toneMappingEffect: ToneMappingEffect = new ToneMappingEffect({ ...TONE_MAPPING_OPTIONS })

  const colorGradeEffect: ColorGradeEffect = new ColorGradeEffect({
    contrast: config('grading.contrast'),
    saturation: config('grading.saturation'),
    shadowTint: config('grading.shadowTint'),
    shadowLift: config('grading.shadowLift'),
    highlightTint: config('grading.highlightTint'),
    highlightGain: config('grading.highlightGain')
  })

  const hdrEffects = {
    bloom: bloomEffect,
    lensFlare: lensFlareEffect,
    exposure: exposureEffect,
    toneMapping: toneMappingEffect
  } as const

  const ldrEffects = {
    chromaticAberration: chromaticAberrationEffect,
    colorGrade: colorGradeEffect,
    dithering: new DitheringEffect()
  } as const

  return [
    new EffectPass(camera, ...HDR_EFFECT_ORDER.map((key) => hdrEffects[key])),
    new EffectPass(camera, ...LDR_EFFECT_ORDER.map((key) => ldrEffects[key]))
  ] as const
}

class Postprocessing {
  public composer: EffectComposer | null = null

  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera
  ) {}

  public initialize(): void {
    this.composer = new EffectComposer(this.renderer, {
      depthBuffer: true,
      frameBufferType: HalfFloatType,
      multisampling: 8
    })

    const renderPass: RenderPass = new RenderPass(this.scene, this.camera)
    const [hdrPass, ldrPass] = createEffectPasses(this.camera)

    this.composer.addPass(renderPass)
    this.composer.addPass(hdrPass)
    this.composer.addPass(ldrPass)
  }

  public render(delta?: number): void {
    this.composer?.render(delta)
  }

  /**
   * Ресайз композера. Без него таргеты пассов остаются размера на момент
   * initialize(), и после ресайза окна кадр — апскейл устаревшего буфера.
   * composer.setSize ресайзит и рендерер, и все пассы.
   */
  public setSize(width: number, height: number): void {
    this.composer?.setSize(width, height)
  }

  public renderToScreenshot(): void {
    const [screenshotWidth, screenshotHeight] = [4096, 2048]

    // pixelRatio=1: композер меряет таргеты в drawing-buffer-пикселях,
    // иначе на Retina получится 8192×4096
    const prevPixelRatio = this.renderer.getPixelRatio()
    this.renderer.setPixelRatio(1)
    this.setSize(screenshotWidth, screenshotHeight)

    const canvas: HTMLCanvasElement = this.renderer.domElement

    this.render()

    canvas.toBlob(async (blob: Blob | null): Promise<void> => {
      if (blob) {
        const a: HTMLAnchorElement = document.createElement('a')
        document.body.appendChild(a!)
        a.style.display = 'none'
        a.href = window.URL.createObjectURL(blob)
        a.download = `screenshot-${Date.now()}.png`
        a.click()
        document.body.removeChild(a)
      }
    })

    this.renderer.setPixelRatio(prevPixelRatio)
    this.setSize(window.innerWidth, window.innerHeight)
  }

  public dispose(): void {
    this.composer?.dispose()
  }
}

export { Postprocessing }
