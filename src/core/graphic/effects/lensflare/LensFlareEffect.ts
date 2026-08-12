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
import { AnamorphicStreakMaterial } from './AnamorphicStreakMaterial'
import { DownsampleThresholdMaterial } from './DownsampleThresholdMaterial'
import { LensFlareFeaturesMaterial } from './LensFlareFeaturesMaterial'
import { LocalContrastMaterial } from './LocalContrastMaterial'
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
  streakAmount?: number
  streakThreshold?: number
  streakScale?: number
  streakTint?: readonly [number, number, number]
  streakSourceCeiling?: number
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
  readonly localContrastMaterial: LocalContrastMaterial
  readonly localContrastPass: ShaderPass

  readonly streakSourceTarget: WebGLRenderTarget
  readonly streakSourcePass: KawaseBlurPass
  readonly streakTarget: WebGLRenderTarget
  readonly streakMaterial: AnamorphicStreakMaterial
  readonly streakPass: ShaderPass

  // Поля верхнего уровня, а не только значения юниформов: Effect.dispose()
  // обходит Object.keys(this), и ресурс, живущий лишь внутри материала, под
  // обход не попадёт и утечёт при пересборке эффекта
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
      starburstAmount,
      streakAmount,
      streakThreshold,
      streakScale,
      streakTint,
      streakSourceCeiling
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

    this.localContrastMaterial = new LocalContrastMaterial()
    this.localContrastPass = new ShaderPass(this.localContrastMaterial)

    // Источник штриха: понижение предразмытого буфера. Ядро MEDIUM сглаживает
    // зернистость поверхности звезды, дававшую продольные волны вдоль полосы.
    //
    // Понижение двойное: у KawaseBlurPass есть свой resolutionScale = 0.5,
    // поэтому размытие идёт в одной восьмой кадра, а в четвертной таргет
    // кладётся растянутая копия — источник вдвое грубее размера таргета
    this.streakSourceTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType
    })
    this.streakSourceTarget.texture.name = 'LensFlare.StreakSource'

    this.streakSourcePass = new KawaseBlurPass({
      kernelSize: KernelSize.MEDIUM
    })

    this.streakTarget = new WebGLRenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType
    })
    this.streakTarget.texture.name = 'LensFlare.Streak'

    this.streakMaterial = new AnamorphicStreakMaterial()
    this.streakPass = new ShaderPass(this.streakMaterial)
    this.featuresMaterial.streakBuffer = this.streakTarget.texture

    // Ассеты объектива движковые, а не сценарные, поэтому их нет в таблице
    // ресурсов. URL через Storage — иначе не заработает режим s3
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

    this.uniforms.get('featuresBuffer').value = this.renderTarget2.texture

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
    if (streakAmount !== undefined) this.featuresMaterial.streakAmount = streakAmount
    if (streakThreshold !== undefined) this.streakMaterial.streakThreshold = streakThreshold
    if (streakScale !== undefined) this.streakMaterial.streakScale = streakScale
    if (streakTint !== undefined) this.streakMaterial.streakTint.set(streakTint[0], streakTint[1], streakTint[2])
    if (streakSourceCeiling !== undefined) this.streakMaterial.streakSourceCeiling = streakSourceCeiling
  }

  private readonly onResolutionChange = (): void => {
    this.setSize(this.resolution.baseWidth, this.resolution.baseHeight)
  }

  override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: TextureDataType): void {
    this.thresholdPass.initialize(renderer, alpha, frameBufferType)
    this.preBlurPass.initialize(renderer, alpha, frameBufferType)
    this.localContrastPass.initialize(renderer, alpha, frameBufferType)
    this.featuresPass.initialize(renderer, alpha, frameBufferType)
    this.streakSourcePass.initialize(renderer, alpha, frameBufferType)
    this.streakPass.initialize(renderer, alpha, frameBufferType)
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, _deltaTime?: number): void {
    if (this.camera !== null) {
      this.featuresMaterial.starburstRotation = computeStarburstRotation(this.camera.matrixWorld)
    }

    // Оба половинных таргета переиспользуются: к локальному контрасту
    // renderTarget1 уже прочитан предразмытием, к артефактам renderTarget2
    // прочитан локальным контрастом
    this.thresholdPass.render(renderer, inputBuffer, this.renderTarget1)
    this.preBlurPass.render(renderer, this.renderTarget1, this.renderTarget2)

    // При streakAmount = 0 вклад штриха нулевой по построению, а стоит он
    // Kawase-источника плюс 129 выборок на пиксель — пропускаем оба прохода.
    // Устаревшее содержимое streakTarget безвредно: единственный его читатель
    // умножает выборку на ту же величину, а при возврате к ненулевой проходы
    // перезапишут таргет в том же кадре, до чтения композитом
    if (this.featuresMaterial.streakAmount !== 0) {
      this.streakSourcePass.render(renderer, this.renderTarget2, this.streakSourceTarget)
      this.streakPass.render(renderer, this.streakSourceTarget, this.streakTarget)
    }

    this.localContrastPass.render(renderer, this.renderTarget2, this.renderTarget1)
    this.featuresPass.render(renderer, this.renderTarget1, this.renderTarget2)
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
    this.localContrastMaterial.setSize(width, height)

    // Четверть базового разрешения: полоса широкая и мягкая, мелких деталей в
    // ней нет. Для streakSourcePass это базовый размер — свои внутренние таргеты
    // он делает вдвое меньше (см. комментарий у создания прохода)
    const streakWidth = Math.max(1, width >> 1)
    const streakHeight = Math.max(1, height >> 1)
    this.streakSourceTarget.setSize(streakWidth, streakHeight)
    this.streakSourcePass.setSize(streakWidth, streakHeight)
    this.streakTarget.setSize(streakWidth, streakHeight)
    // texelSize — по сэмплируемому буферу, то есть по источнику штриха:
    // streakScale меряет шаг в его текселях
    this.streakMaterial.setSize(streakWidth, streakHeight)
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
