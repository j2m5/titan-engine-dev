import { HalfFloatType, PerspectiveCamera, Scene, Vector2, WebGLRenderer } from 'three'
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  Pass,
  ToneMappingEffect,
  ToneMappingMode
} from 'postprocessing'
import type { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { captureAtmosphereFrame } from './effects/atmosphere/atmosphereFrame'
import { createSceneEndpointPasses } from './sceneEndpointPasses'
import { SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import { CloudBlendPass } from './clouds/CloudBlendPass'
import { SceneCloudComposition, CloudEndpointCapturePass } from './clouds/SceneCloudComposition'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { LensRegistry } from '@/core/services/LensRegistry'
import { LensFlareEffect } from '@/core/graphic/effects/lensflare/LensFlareEffect'
import { ExposureEffect } from '@/core/graphic/effects/grading/ExposureEffect'
import { ColorGradeEffect } from '@/core/graphic/effects/grading/ColorGradeEffect'
import { DitheringEffect } from '@/core/graphic/effects/dithering/DitheringEffect'
import { config } from '@/core/framework/config'
import { screenshotSize, type ScreenshotSize } from '@/core/graphic/screenshot'

// Опции эффектов вынесены в константы под контракт-тесты
// (tests/graphic/PostprocessingContract.spec.ts)

// Инвариант bloom-guard: luminanceThreshold (1.0) обязан оставаться ВЫШЕ
// LDR-клампа планеты (0.99, PlanetSurfaceCommon) — её диффуз не блумит.
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
    intensity: config('lensFlare.intensity'),
    ghostAmount: config('lensFlare.ghostAmount'),
    ghostVignette: config('lensFlare.ghostVignette'),
    ghostChromatic: config('lensFlare.ghostChromatic'),
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
  private prefix: readonly Pass[] = []
  private atmosphere: AtmosphereEffect | null = null
  private composition: SceneCloudComposition | null = null
  private blend = new CloudBlendPass()
  private serial = 0

  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly atmosphereRegistry: AtmosphereRegistry,
    private readonly depthVolumeRegistry: DepthVolumeRegistry,
    private readonly lensRegistry: LensRegistry = new LensRegistry(),
    public readonly cloudRuntime?: SceneCloudRuntime
  ) {}

  /**
   * Список пассов в порядке рендера. Вынесен из `initialize()`: composer
   * требует рендерер, а порядок — несущий инвариант и проверяется тестом.
   *
   * Пыль колец — сразу за сценой, в тот же буфер (без swap): её марш режется
   * по глубине сцены, а глубина готова только после RenderPass.
   *
   * Меш чёрной дыры — свой пасс за объёмами: сэмплирует копию кадра (сцена и
   * объёмы за дырой лензируются сильным полем), пишет свою глубину.
   *
   * Линза — следом: сдвигает готовый кадр снаружи меша чёрной дыры, читает
   * соседей и глубину.
   *
   * Оверлеи (линии орбит) — после линз: схематичные линии не искривляются,
   * атмосфера следом тонирует их как прежде.
   *
   * Прозрачное перед активной чёрной дырой (кольца, гало, импосторы, объёмы)
   * размечает LensFrontSplitPass до основного прохода, рисует LensFrontPass
   * поверх лензированного кадра — иначе проходы дыры берут его как фон.
   * Оверлеи идут после него: линии орбит остаются поверх всего.
   *
   * Атмосфера — СВОЙ пасс между линзой и HDR-проходом: она тонирует и гало
   * пыли, а блум считает яркость по входу своего пасса, значит должен видеть
   * уже затуманенный кадр.
   */
  public buildPasses(): readonly Pass[] {
    const [hdrPass, ldrPass] = createEffectPasses(this.camera)
    const endpoint = createSceneEndpointPasses({
      scene: this.scene,
      camera: this.camera,
      atmosphereRegistry: this.atmosphereRegistry,
      depthVolumeRegistry: this.depthVolumeRegistry,
      lensRegistry: this.lensRegistry,
      atmosphereDebugView: readAtmosphereDebugView()
    })
    this.prefix = endpoint.passes
    this.atmosphere = endpoint.atmosphere
    return [...endpoint.passes, ...(this.cloudRuntime ? [this.blend] : []), hdrPass, ldrPass]
  }

  public initialize(): void {
    this.composer = new EffectComposer(this.renderer, {
      depthBuffer: true,
      frameBufferType: HalfFloatType,
      multisampling: 8
    })

    for (const pass of this.buildPasses()) this.composer.addPass(pass)
    if (this.cloudRuntime)
      this.composition = new SceneCloudComposition(this.renderer, this.scene, this.camera, this.cloudRuntime, () => {
        const endpoint = createSceneEndpointPasses({
          scene: this.scene,
          camera: this.camera,
          atmosphereRegistry: this.atmosphereRegistry,
          depthVolumeRegistry: this.depthVolumeRegistry,
          lensRegistry: this.lensRegistry,
          atmosphereDebugView: readAtmosphereDebugView()
        })
        const composer = new EffectComposer(this.renderer, {
          depthBuffer: true,
          frameBufferType: HalfFloatType,
          multisampling: 8
        })
        composer.autoRenderToScreen = false
        const capture = new CloudEndpointCapturePass()
        for (const pass of [...endpoint.passes, capture]) {
          pass.renderToScreen = false
          composer.addPass(pass)
        }
        return { composer, atmosphere: endpoint.atmosphere, capture }
      })
  }

  public render(delta?: number): void {
    if (!this.composer) return
    this.scene.updateMatrixWorld(true)
    this.camera.updateMatrixWorld(true)
    const snapshot = captureAtmosphereFrame(this.camera, this.atmosphereRegistry, ++this.serial)
    this.atmosphere?.setFrame(snapshot)
    this.atmosphere?.setCloudOverlay(null)
    const lensActive = this.lensRegistry.entries().some((entry) => {
      let visible = true
      entry.object.traverseAncestors((parent) => {
        if (!parent.visible) visible = false
      })
      return visible && entry.object.visible
    })
    const plan = this.cloudRuntime?.beginFrame(
      this.camera,
      this.renderer.getDrawingBufferSize(new Vector2()),
      this.serial,
      delta ?? 0,
      snapshot,
      lensActive,
      readAtmosphereDebugView()
    )
    const near = plan ? this.composition?.prepare(plan, snapshot) : null
    for (const pass of this.prefix) pass.enabled = !near || near.weight < 1
    this.blend.setNear(near?.texture ?? null, near?.weight ?? 0)
    try {
      this.composer.render(delta)
      this.cloudRuntime?.recordPasses({ farRenders: !near || near.weight < 1 ? 1 : 0, finalRenders: 1 })
    } finally {
      this.blend.setNear(null, 0)
      this.atmosphere?.setFrame(null)
    }
  }

  /**
   * Ресайз композера. Без него таргеты пассов остаются размера на момент
   * initialize(), и после ресайза окна кадр — апскейл устаревшего буфера.
   * composer.setSize ресайзит и рендерер, и все пассы.
   */
  public setSize(width: number, height: number): void {
    this.composer?.setSize(width, height)
    this.composition?.setSize(width, height)
  }

  /**
   * Снимок текущего кадра в 4K «как на экране» (screenshotSize): высота 2160,
   * ширина по пропорции окна. Aspect камеры тот же, поэтому её не трогаем.
   * Рендер — вне цикла кадра, состояние сцены (LOD, размеры импосторов) из
   * последнего кадра: снимок — тот же вид, только крупнее. DOM-оверлеи
   * (подписи, маркеры, UI) в канвас не входят.
   *
   * Порядок несущий:
   * - pixelRatio 1 ДО ресайза: композер меряет таргеты в drawing-buffer-пикселях;
   * - ресайз без updateStyle: CSS-размер канваса не меняется, страница не дёргается;
   * - toBlob копирует битмап в момент вызова, кодирование асинхронное — возврат
   *   размера сразу следом снимок не портит;
   * - при возврате CSS-размер ДО pixelRatio: setPixelRatio сам пересчитывает
   *   канвас от текущего размера и на миг раздул бы его до 7680×4320;
   * - возврат в finally: исключение рендера не оставляет окно в 4K.
   */
  public captureScreenshot(): Promise<Blob | null> {
    const cssSize: Vector2 = this.renderer.getSize(new Vector2())
    const pixelRatio: number = this.renderer.getPixelRatio()
    const gl: WebGL2RenderingContext = this.renderer.getContext() as WebGL2RenderingContext
    // MSAA-таргеты композера — renderbuffer'ы: их предел бывает ниже текстурного
    const maxSize: number = Math.min(
      this.renderer.capabilities.maxTextureSize,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number
    )
    const size: ScreenshotSize = screenshotSize(cssSize.width, cssSize.height, maxSize)
    const canvas: HTMLCanvasElement = this.renderer.domElement
    let blob: Promise<Blob | null>

    this.renderer.setPixelRatio(1)

    try {
      this.composer?.setSize(size.width, size.height, false)
      this.composition?.setSize(size.width, size.height)
      this.render()
      blob = new Promise((resolve: (value: Blob | null) => void): void => canvas.toBlob(resolve, 'image/png'))
    } finally {
      this.renderer.setSize(cssSize.width, cssSize.height, false)
      this.renderer.setPixelRatio(pixelRatio)
      this.composer?.setSize(cssSize.width, cssSize.height, false)
      this.composition?.setSize(cssSize.width, cssSize.height)
    }

    return blob
  }

  public dispose(): void {
    this.composition?.dispose()
    this.composition = null
    this.cloudRuntime?.invalidate(null)
    this.composer?.dispose()
    this.composer = null
  }
}

export { Postprocessing }
