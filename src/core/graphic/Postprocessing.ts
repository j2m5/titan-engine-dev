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

    const bloomEffect: BloomEffect = new BloomEffect({ ...BLOOM_OPTIONS })

    const lensFlareEffect: LensFlareEffect = new LensFlareEffect({
      intensity: config('lensFlare.intensity'),
      ghostAmount: config('lensFlare.ghostAmount'),
      haloAmount: config('lensFlare.haloAmount'),
      chromaticAberration: config('lensFlare.chromaticAberration'),
      // порог — общий с bloom: два разных числа разъехались бы при первой правке
      thresholdLevel: BLOOM_OPTIONS.luminanceThreshold
    })

    const chromaticAberrationEffect: ChromaticAberrationEffect = new ChromaticAberrationEffect({
      blendFunction: BlendFunction.SCREEN,
      offset: new Vector2(0.0005, 0.0005),
      radialModulation: true,
      modulationOffset: 0.4
    })

    const toneMappingEffect: ToneMappingEffect = new ToneMappingEffect({ ...TONE_MAPPING_OPTIONS })

    // Порядок аргументов — несущий: bloom и lens flare должны считаться ДО
    // тонмаппинга (по HDR-значениям, ещё не сжатым в LDR); менять порядок
    // нельзя, иначе AgX сожмёт диапазон раньше, чем эффекты увидят пересветы.
    const effectPass: EffectPass = new EffectPass(this.camera, bloomEffect, lensFlareEffect, toneMappingEffect)

    // Дизеринг строго последним: после него только квантование в канвас
    const effectPass2: EffectPass = new EffectPass(this.camera, chromaticAberrationEffect, new DitheringEffect())

    this.composer.addPass(renderPass)
    this.composer.addPass(effectPass)
    this.composer.addPass(effectPass2)
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
