import { BlendFunction, Effect, EffectAttribute, KawaseBlurPass, KernelSize, Resolution, ShaderPass } from 'postprocessing'
import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearSRGBColorSpace,
  SRGBColorSpace,
  TextureLoader,
  Uniform,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type TextureDataType,
  type WebGLRenderer
} from 'three'

import { Storage } from '@/core/framework/file/Storage'
import { DownsampleThresholdMaterial } from './DownsampleThresholdMaterial'
import { LensFlareFeaturesMaterial } from './LensFlareFeaturesMaterial'
import { computeStarburstRotation } from './starburstRotation'

const fragmentShader: string = `
  uniform sampler2D featuresBuffer;
  uniform float intensity;

  void mainImage(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {
    vec3 features = texture(featuresBuffer, uv).rgb;
    outputColor = vec4(inputColor.rgb + features * intensity, inputColor.a);
  }
`

export type UniformMap<T> = Omit<Map<string, Uniform>, 'get'> & {
  get: <K extends keyof T>(key: K) => T[K]
  set: <K extends keyof T>(key: K, value: T[K]) => void
}

export interface LensFlareEffectOptions {
  blendFunction?: BlendFunction
  resolutionScale?: number
  width?: number
  height?: number
  resolutionX?: number
  resolutionY?: number
  intensity?: number
  ghostAmount?: number
  ghostThreshold?: number
  ghostAttenuation?: number
  haloAmount?: number
  chromaticAberration?: number
  thresholdLevel?: number
  camera?: Camera
  starburstAmount?: number
}

export interface LensFlareEffectUniforms {
  featuresBuffer: Uniform<Texture | null>
  intensity: Uniform<number>
}

export const lensFlareEffectOptionsDefaults = {
  blendFunction: BlendFunction.NORMAL,
  resolutionScale: 0.5,
  width: Resolution.AUTO_SIZE,
  height: Resolution.AUTO_SIZE,
  intensity: 0.005
} satisfies LensFlareEffectOptions

// Reference: https://www.froyok.fr/blog/2021-09-ue4-custom-lens-flare/
export class LensFlareEffect extends Effect {
  declare uniforms: UniformMap<LensFlareEffectUniforms>

  readonly resolution: Resolution
  readonly renderTarget1: WebGLRenderTarget
  readonly renderTarget2: WebGLRenderTarget

  readonly thresholdMaterial: DownsampleThresholdMaterial
  readonly thresholdPass: ShaderPass
  readonly preBlurPass: KawaseBlurPass
  readonly featuresMaterial: LensFlareFeaturesMaterial
  readonly featuresPass: ShaderPass

  // Собственное поле, а не только значение uniform'а материала: штатный
  // Effect.dispose() из postprocessing обходит Object.keys(this) верхнего
  // уровня эффекта и разбирает всё, что instanceof Texture/Material/
  // WebGLRenderTarget/Pass. Текстура, спрятанная только внутри
  // featuresMaterial.uniforms.lensColor.value, под этот обход не попадает и
  // молча течёт на каждой пересборке эффекта. Тот же паттерн — поле эффекта
  // + присвоение в материал — использовать и для будущей текстуры старберста.
  readonly lensColorTexture: Texture
  readonly starburstTexture: Texture

  // Ориентация — свойство объектива, а не сцены: направление на звезду сюда
  // не входит, эффекту оно неизвестно (см. computeStarburstRotation)
  private readonly camera: Camera | null

  constructor(options?: LensFlareEffectOptions) {
    const {
      blendFunction,
      resolutionScale,
      width,
      height,
      resolutionX = width,
      resolutionY = height,
      intensity,
      ghostAmount,
      ghostThreshold,
      ghostAttenuation,
      haloAmount,
      chromaticAberration,
      thresholdLevel,
      camera,
      starburstAmount
    } = {
      ...lensFlareEffectOptionsDefaults,
      ...options
    }
    super('LensFlareEffect', fragmentShader, {
      blendFunction,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>(
        Object.entries({
          featuresBuffer: new Uniform(null),
          intensity: new Uniform(1)
        } satisfies LensFlareEffectUniforms)
      )
    })

    this.renderTarget1 = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType
    })
    this.renderTarget1.texture.name = 'LensFlare.Target1'

    this.renderTarget2 = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType
    })
    this.renderTarget2.texture.name = 'LensFlare.Target2'

    this.thresholdMaterial = new DownsampleThresholdMaterial()
    this.thresholdPass = new ShaderPass(this.thresholdMaterial)

    this.preBlurPass = new KawaseBlurPass({
      kernelSize: KernelSize.SMALL
    })

    this.featuresMaterial = new LensFlareFeaturesMaterial()
    this.featuresPass = new ShaderPass(this.featuresMaterial)

    // Ассеты объектива — движковые, а не сценарные: объектив у всех сценариев
    // один, поэтому их нет в таблице ресурсов. URL через Storage: иначе режим
    // s3 не заработает
    const lensColorUrl = Storage.url('lenscolor.png')
    this.lensColorTexture = new TextureLoader().load(lensColorUrl, undefined, undefined, () => {
      console.warn(
        `[LensFlareEffect] Не удалось загрузить градиент палитры призраков "${lensColorUrl}" — призраки объектива не будут нарисованы`
      )
    })
    this.lensColorTexture.name = 'LensFlare.LensColor'
    this.lensColorTexture.colorSpace = SRGBColorSpace
    this.lensColorTexture.wrapS = ClampToEdgeWrapping
    this.lensColorTexture.wrapT = ClampToEdgeWrapping
    this.featuresMaterial.lensColorTexture = this.lensColorTexture

    const starburstUrl = Storage.url('lensstar.png')
    this.starburstTexture = new TextureLoader().load(starburstUrl, undefined, undefined, () => {
      console.warn(
        `[LensFlareEffect] Не удалось загрузить маску лучей объектива "${starburstUrl}" — лучи объектива не будут нарисованы`
      )
    })
    this.starburstTexture.name = 'LensFlare.Starburst'
    // маска, а не цвет: sRGB-декод к ней неприменим
    this.starburstTexture.colorSpace = LinearSRGBColorSpace
    this.starburstTexture.wrapS = ClampToEdgeWrapping
    this.starburstTexture.wrapT = ClampToEdgeWrapping
    this.featuresMaterial.starburstTexture = this.starburstTexture

    this.uniforms.get('featuresBuffer').value = this.renderTarget1.texture

    this.resolution = new Resolution(this, resolutionX, resolutionY, resolutionScale)
    this.resolution.addEventListener('change', this.onResolutionChange)

    this.camera = camera ?? null

    this.intensity = intensity
    if (ghostAmount !== undefined) this.featuresMaterial.ghostAmount = ghostAmount
    if (ghostThreshold !== undefined) this.featuresMaterial.ghostThreshold = ghostThreshold
    if (ghostAttenuation !== undefined) this.featuresMaterial.ghostAttenuation = ghostAttenuation
    if (haloAmount !== undefined) this.featuresMaterial.haloAmount = haloAmount
    if (chromaticAberration !== undefined) this.featuresMaterial.chromaticAberration = chromaticAberration
    if (thresholdLevel !== undefined) this.thresholdLevel = thresholdLevel
    if (starburstAmount !== undefined) this.featuresMaterial.starburstAmount = starburstAmount
  }

  private readonly onResolutionChange = (): void => {
    this.setSize(this.resolution.baseWidth, this.resolution.baseHeight)
  }

  override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: TextureDataType): void {
    this.thresholdPass.initialize(renderer, alpha, frameBufferType)
    this.preBlurPass.initialize(renderer, alpha, frameBufferType)
    this.featuresPass.initialize(renderer, alpha, frameBufferType)
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime?: number): void {
    if (this.camera !== null) {
      this.featuresMaterial.starburstRotation = computeStarburstRotation(this.camera.matrixWorld)
    }

    this.thresholdPass.render(renderer, inputBuffer, this.renderTarget1)
    this.preBlurPass.render(renderer, this.renderTarget1, this.renderTarget2)
    this.featuresPass.render(renderer, this.renderTarget2, this.renderTarget1)
  }

  override setSize(baseWidth: number, baseHeight: number): void {
    const resolution = this.resolution
    resolution.setBaseSize(baseWidth, baseHeight)

    const { width, height } = resolution
    this.renderTarget1.setSize(width, height)
    this.renderTarget2.setSize(width, height)
    this.thresholdMaterial.setSize(width, height)
    this.preBlurPass.setSize(width, height)
    this.featuresMaterial.setSize(width, height)
  }

  get intensity(): number {
    return this.uniforms.get('intensity').value
  }

  set intensity(value: number) {
    this.uniforms.get('intensity').value = value
  }

  get thresholdLevel(): number {
    return this.thresholdMaterial.thresholdLevel
  }

  set thresholdLevel(value: number) {
    this.thresholdMaterial.thresholdLevel = value
  }

  get thresholdRange(): number {
    return this.thresholdMaterial.thresholdRange
  }

  set thresholdRange(value: number) {
    this.thresholdMaterial.thresholdRange = value
  }
}
