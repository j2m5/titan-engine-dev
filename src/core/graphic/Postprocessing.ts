import { HalfFloatType, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three'
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  Pass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode
} from 'postprocessing'
import { createAtmospherePass } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import type { RingDustRegistry } from '@/core/services/RingDustRegistry'
import { RingDustPass } from '@/core/graphic/passes/RingDustPass'
import { LensFlareEffect } from '@/core/graphic/effects/lensflare/LensFlareEffect'
import { ExposureEffect } from '@/core/graphic/effects/grading/ExposureEffect'
import { ColorGradeEffect } from '@/core/graphic/effects/grading/ColorGradeEffect'
import { DitheringEffect } from '@/core/graphic/effects/dithering/DitheringEffect'
import { config } from '@/core/framework/config'

// Опции эффектов вынесены в константы под контракт-тесты
// (tests/graphic/PostprocessingContract.spec.ts)

// Инвариант bloom-guard: luminanceThreshold (1.0) обязан оставаться ВЫШЕ
// LDR-клампа планеты (0.99, PlanetShaderTemplate) — её диффуз не блумит.
// HDR-глинт океана добавляется ПОСЛЕ клампа и блумит намеренно. Честные
// HDR-источники: звёзды, диск ЧД, туманности, глинт

/**
 * Форма гало. levels — докуда оно дотягивается: уровень удваивает охват.
 * radius — вес mix(резкий уровень, размытый нижний), 0..1; выше 1 это
 * экстраполяция, и SCREEN с отрицательным блумом ЗАТЕМНЯЕТ. intensity — сила.
 * Ручки связаны: вклад самого широкого мипа равен radius^(levels − 1).
 * Значения СТАРТОВЫЕ, не замер — приёмку по картинке делает владелец.
 *
 * Гало намеренно сильное: диск звезды не должен читаться жёсткой границей.
 * Мягкость даёт radius (вес размытых нижних мипов), силу — intensity; порог
 * не участвует, он часть bloom-guard. Ручка ГЛОБАЛЬНАЯ: ярче становятся все
 * честные HDR-источники — диск ЧД, туманности, глинт океана.
 */
export const BLOOM_OPTIONS = {
  radius: 0.98,
  levels: 9,
  blendFunction: BlendFunction.SCREEN,
  mipmapBlur: true,
  luminanceThreshold: 1,
  luminanceSmoothing: 0.0025,
  intensity: 2.2
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
    streakSourceCeiling: config('lensFlare.streakSourceCeiling'),
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

/** `?atmoDebug=<1|2|3|4>` — дебаг-вид эффекта атмосферы в основной сцене (0 — выключен). */
export function readAtmosphereDebugView(search: string = location.search): number {
  const raw = new URLSearchParams(search).get('atmoDebug')
  const value = raw === null ? 0 : Number(raw)
  return Number.isInteger(value) && value >= 1 && value <= 4 ? value : 0
}

class Postprocessing {
  public composer: EffectComposer | null = null

  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly atmosphereRegistry: AtmosphereRegistry,
    private readonly ringDustRegistry: RingDustRegistry
  ) {}

  /**
   * Список пассов в порядке рендера. Вынесен из `initialize()`: composer
   * требует рендерер, а порядок — несущий инвариант и проверяется тестом.
   *
   * Пыль колец — сразу за сценой, в тот же буфер (без swap): её марш режется
   * по глубине сцены, а глубина готова только после RenderPass.
   *
   * Атмосфера — СВОЙ пасс между пылью и HDR-проходом: она тонирует и гало
   * пыли, а блум считает яркость по входу своего пасса, значит должен видеть
   * уже затуманенный кадр.
   */
  public buildPasses(): readonly Pass[] {
    const [hdrPass, ldrPass] = createEffectPasses(this.camera)

    return [
      new RenderPass(this.scene, this.camera),
      new RingDustPass(this.camera, this.ringDustRegistry),
      createAtmospherePass(this.camera, this.atmosphereRegistry, readAtmosphereDebugView()),
      hdrPass,
      ldrPass
    ]
  }

  public initialize(): void {
    this.composer = new EffectComposer(this.renderer, {
      depthBuffer: true,
      frameBufferType: HalfFloatType,
      multisampling: 8
    })

    for (const pass of this.buildPasses()) this.composer.addPass(pass)
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
