import { threeJS } from '@/core/graphic/ThreeJS'
import { HalfFloatType, Material, MeshBasicMaterial, Object3D, ShaderMaterial } from 'three'
import { isHavingMaterial } from '@/core/helpers/predicates'
import { BlendFunction, BloomEffect, EffectComposer, EffectPass, RenderPass, ShaderPass } from 'postprocessing'
import { AdditiveBlendingShaderTemplate } from '@/core/materials/shaders/lib/AdditiveBlendingShaderTemplate'

/**
 * Старая имплементация постобработки, не идеальная, но надежно фильтрует объекты на сцене которые не должны быть никак задеты постобработкой
 * TODO нужна еще более продвинутая система лишенная недостатков обоих подходов
 */
class Postprocessing {
  public composer: EffectComposer | null = null
  public bloomComposer: EffectComposer | null = null

  private darkMaterial: Material = new MeshBasicMaterial({ color: '#000000' })
  private materials: { [uuid: string]: Material | Material[] } = {}

  public init(): void {
    this.composer = new EffectComposer(threeJS.renderer, {
      stencilBuffer: true,
      depthBuffer: true,
      frameBufferType: HalfFloatType,
      multisampling: 4
    })

    this.bloomComposer = new EffectComposer(threeJS.renderer, {
      frameBufferType: HalfFloatType
    })

    this.bloomComposer.autoRenderToScreen = false

    const renderPass: RenderPass = new RenderPass(threeJS.scene, threeJS.camera)

    const bloomEffect: BloomEffect = new BloomEffect({
      radius: 0.7,
      blendFunction: BlendFunction.SCREEN,
      mipmapBlur: true,
      luminanceThreshold: 0.1,
      luminanceSmoothing: 0.0025,
      intensity: 5
    })

    const effectPass: EffectPass = new EffectPass(threeJS.camera, bloomEffect)

    const mixMaterial: ShaderMaterial = new ShaderMaterial(AdditiveBlendingShaderTemplate)
    const mixPass: ShaderPass = new ShaderPass(mixMaterial, 'tDiffuse')

    mixMaterial.uniforms.tAdd.value = this.bloomComposer.outputBuffer.texture
    mixPass.needsSwap = true

    this.bloomComposer.addPass(renderPass)
    this.bloomComposer.addPass(effectPass)
    this.composer.addPass(renderPass)
    this.composer.addPass(mixPass)
  }

  public render(delta?: number): void {
    threeJS.scene.traverse((object: Object3D): void => {
      this.maskMaterials(object)
    })
    this.bloomComposer?.render(delta)
    threeJS.scene.traverse((object: Object3D): void => {
      this.restoreMaterials(object)
    })
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
    this.bloomComposer?.dispose()
    this.composer?.dispose()
  }

  private maskMaterials(object: Object3D): void {
    if (isHavingMaterial(object) && object.userData.hasBloom === undefined) {
      this.materials[object.uuid] = object.material
      object.material = this.darkMaterial
    }
  }

  private restoreMaterials(object: Object3D): void {
    if (isHavingMaterial(object) && this.materials[object.uuid]) {
      object.material = this.materials[object.uuid]
      delete this.materials[object.uuid]
    }
  }
}

export const postprocessing: Postprocessing = new Postprocessing()
