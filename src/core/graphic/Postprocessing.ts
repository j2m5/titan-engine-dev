import { threeJS } from '@/core/graphic/ThreeJS'
import { HalfFloatType } from 'three'
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode
} from 'postprocessing'
import { LensFlareEffect } from '@/core/graphic/effects/lensflare/LensFlareEffect'

/**
 * Старая имплементация постобработки, не идеальная, но надежно фильтрует объекты на сцене которые не должны быть никак задеты постобработкой
 * TODO нужна еще более продвинутая система лишенная недостатков обоих подходов
 */
class Postprocessing {
  public composer: EffectComposer | null = null

  public init(): void {
    this.composer = new EffectComposer(threeJS.renderer, {
      depthBuffer: true,
      frameBufferType: HalfFloatType,
      multisampling: 8
    })

    const renderPass: RenderPass = new RenderPass(threeJS.scene, threeJS.camera)

    const bloomEffect: BloomEffect = new BloomEffect({
      radius: 0.8,
      blendFunction: BlendFunction.SCREEN,
      mipmapBlur: true,
      luminanceThreshold: 1,
      luminanceSmoothing: 0.0025,
      intensity: 5
    })

    const lensFlareEffect: LensFlareEffect = new LensFlareEffect({ intensity: 0.02 })

    const toneMappingEffect: ToneMappingEffect = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
      blendFunction: BlendFunction.DST,
      resolution: 256,
      whitePoint: 16,
      middleGrey: 0.6,
      minLuminance: 0.01,
      averageLuminance: 1,
      adaptationRate: 1
    })

    const effectPass: EffectPass = new EffectPass(threeJS.camera, bloomEffect, lensFlareEffect, toneMappingEffect)

    this.composer.addPass(renderPass)
    this.composer.addPass(effectPass)
  }

  public render(delta?: number): void {
    this.composer?.render(delta)
  }

  public renderToScreenshot(): void {
    const [screenshotWidth, screenshotHeight] = [4096, 2048]

    threeJS.renderer.setSize(screenshotWidth, screenshotHeight)

    const canvas: HTMLCanvasElement = threeJS.renderer.domElement

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

    threeJS.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  public dispose(): void {
    this.composer?.dispose()
  }
}

export const postprocessing: Postprocessing = new Postprocessing()
