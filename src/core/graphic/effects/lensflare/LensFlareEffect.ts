import { BlendFunction, Effect, EffectAttribute, KawaseBlurPass, KernelSize, Resolution, ShaderPass } from 'postprocessing'
import {
  Color,
  FloatType,
  HalfFloatType,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  Scene,
  Uniform,
  WebGLRenderTarget,
  type InstancedBufferGeometry,
  type Texture,
  type TextureDataType,
  type WebGLRenderer
} from 'three'

import { AnamorphicStreakMaterial } from './AnamorphicStreakMaterial'
import { DownsampleThresholdMaterial } from './DownsampleThresholdMaterial'
import { LocalContrastMaterial } from './LocalContrastMaterial'
import { FlareGridMaterial } from './FlareGridMaterial'
import { FlareSelectMaterial } from './FlareSelectMaterial'
import { FlareGhostMaterial } from './FlareGhostMaterial'
import { FlareStarburstMaterial } from './FlareStarburstMaterial'
import { createSpriteQuad } from './flareSprites'
import { flareGridSize, type FlareGridSize } from './flareGrid'
import { FLARE_GHOSTS } from './flareGhosts'

const fragmentShader: string = `
  uniform sampler2D ghostBuffer;
  uniform sampler2D starburstBuffer;
  uniform sampler2D streakBuffer;
  uniform float ghostAmount;
  uniform float starburstAmount;
  uniform float streakAmount;
  uniform float intensity;

  void mainImage(const vec4 inputColor, const vec2 uv, out vec4 outputColor) {
    // Множители здесь, а не в проходах: при пропуске проходов устаревшее
    // содержимое буферов умножается на ноль
    vec3 flare = texture(ghostBuffer, uv).rgb * ghostAmount
      + texture(starburstBuffer, uv).rgb * starburstAmount
      + texture(streakBuffer, uv).rgb * streakAmount;
    outputColor = vec4(inputColor.rgb + flare * intensity, inputColor.a);
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
  ghostVignette?: number
  ghostChromatic?: number
  starburstAmount?: number
  starburstMinFlux?: number
  thresholdLevel?: number
  streakAmount?: number
  streakThreshold?: number
  streakScale?: number
  streakTint?: readonly [number, number, number]
  streakSourceCeiling?: number
}

export interface LensFlareEffectUniforms {
  ghostBuffer: Uniform<Texture | null>
  starburstBuffer: Uniform<Texture | null>
  streakBuffer: Uniform<Texture | null>
  ghostAmount: Uniform<number>
  starburstAmount: Uniform<number>
  streakAmount: Uniform<number>
  intensity: Uniform<number>
}

export const lensFlareEffectOptionsDefaults = {
  blendFunction: BlendFunction.NORMAL,
  resolutionScale: 0.5,
  width: Resolution.AUTO_SIZE,
  height: Resolution.AUTO_SIZE,
  intensity: 0.005,
  ghostAmount: 1,
  ghostVignette: 2,
  ghostChromatic: 0.04,
  starburstAmount: 1,
  starburstMinFlux: 200,
  streakAmount: 0
} satisfies LensFlareEffectOptions

/** Таргет сетки: Float32 (центр яркости в Float16 ошибался бы до 0.5 px), читается texelFetch */
function createGridTarget(name: string): WebGLRenderTarget {
  const target = new WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    type: FloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false
  })
  target.texture.name = name
  return target
}

function createHalfFloatTarget(name: string): WebGLRenderTarget {
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType })
  target.texture.name = name
  return target
}

/**
 * Блик объектива: анаморфные призраки и starburst — спрайты от ярких ячеек
 * буфера локального контраста, плюс анаморфный штрих. Эффект видит только
 * яркие пиксели кадра и ничего не знает об источниках сцены.
 *
 * Reference (штрих и порог): https://www.froyok.fr/blog/2021-09-ue4-custom-lens-flare/
 */
export class LensFlareEffect extends Effect {
  declare uniforms: UniformMap<LensFlareEffectUniforms>

  readonly resolution: Resolution
  readonly renderTarget1: WebGLRenderTarget
  readonly renderTarget2: WebGLRenderTarget

  readonly thresholdMaterial: DownsampleThresholdMaterial
  readonly thresholdPass: ShaderPass
  readonly preBlurPass: KawaseBlurPass
  readonly localContrastMaterial: LocalContrastMaterial
  readonly localContrastPass: ShaderPass

  readonly streakSourceTarget: WebGLRenderTarget
  readonly streakSourcePass: KawaseBlurPass
  readonly streakTarget: WebGLRenderTarget
  readonly streakMaterial: AnamorphicStreakMaterial
  readonly streakPass: ShaderPass

  // Сетка источников и отбор: Float32, размер — сетка (flareGrid.ts)
  readonly gridFluxTarget: WebGLRenderTarget
  readonly gridCentroidTarget: WebGLRenderTarget
  readonly sourceFluxTarget: WebGLRenderTarget
  readonly sourceCentroidTarget: WebGLRenderTarget
  readonly gridFluxMaterial: FlareGridMaterial
  readonly gridCentroidMaterial: FlareGridMaterial
  readonly gridFluxPass: ShaderPass
  readonly gridCentroidPass: ShaderPass
  readonly selectFluxMaterial: FlareSelectMaterial
  readonly selectCentroidMaterial: FlareSelectMaterial
  readonly selectFluxPass: ShaderPass
  readonly selectCentroidPass: ShaderPass

  // Спрайты: призраки — четверть разрешения, лучи — в renderTarget2.
  // Поля верхнего уровня: Effect.dispose() обходит Object.keys(this)
  readonly ghostTarget: WebGLRenderTarget
  readonly ghostGeometry: InstancedBufferGeometry
  readonly ghostMaterial: FlareGhostMaterial
  readonly starburstGeometry: InstancedBufferGeometry
  readonly starburstMaterial: FlareStarburstMaterial

  gridSize: FlareGridSize = flareGridSize(1, 1)

  private readonly ghostScene: Scene = new Scene()
  private readonly starburstScene: Scene = new Scene()
  // Вершинные шейдеры спрайтов пишут клип-координаты сами — камера формальная
  private readonly spriteCamera: OrthographicCamera = new OrthographicCamera()
  private readonly clearColor: Color = new Color()

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
      ghostVignette,
      ghostChromatic,
      starburstAmount,
      starburstMinFlux,
      thresholdLevel,
      streakAmount,
      streakThreshold,
      streakScale,
      streakTint,
      streakSourceCeiling
    } = {
      ...lensFlareEffectOptionsDefaults,
      ...options
    }

    // Ручки, общие композиту и спрайтам: одни объекты Uniform
    const shared = {
      ghostAmount: new Uniform(ghostAmount),
      starburstAmount: new Uniform(starburstAmount),
      streakAmount: new Uniform(streakAmount),
      intensity: new Uniform(intensity)
    }

    super('LensFlareEffect', fragmentShader, {
      blendFunction,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, Uniform>(
        Object.entries({
          ghostBuffer: new Uniform(null),
          starburstBuffer: new Uniform(null),
          streakBuffer: new Uniform(null),
          ...shared
        } satisfies LensFlareEffectUniforms)
      )
    })

    this.renderTarget1 = createHalfFloatTarget('LensFlare.Target1')
    this.renderTarget2 = createHalfFloatTarget('LensFlare.Target2')

    this.thresholdMaterial = new DownsampleThresholdMaterial()
    this.thresholdPass = new ShaderPass(this.thresholdMaterial)
    this.preBlurPass = new KawaseBlurPass({ kernelSize: KernelSize.SMALL })
    this.localContrastMaterial = new LocalContrastMaterial()
    this.localContrastPass = new ShaderPass(this.localContrastMaterial)

    // Источник штриха: понижение предразмытого буфера ядром MEDIUM. Понижение
    // двойное: у KawaseBlurPass свой resolutionScale = 0.5
    this.streakSourceTarget = createHalfFloatTarget('LensFlare.StreakSource')
    this.streakSourcePass = new KawaseBlurPass({ kernelSize: KernelSize.MEDIUM })
    this.streakTarget = createHalfFloatTarget('LensFlare.Streak')
    this.streakMaterial = new AnamorphicStreakMaterial()
    this.streakPass = new ShaderPass(this.streakMaterial)

    this.gridFluxTarget = createGridTarget('LensFlare.GridFlux')
    this.gridCentroidTarget = createGridTarget('LensFlare.GridCentroid')
    this.sourceFluxTarget = createGridTarget('LensFlare.SourceFlux')
    this.sourceCentroidTarget = createGridTarget('LensFlare.SourceCentroid')
    this.gridFluxMaterial = new FlareGridMaterial('flux')
    this.gridCentroidMaterial = new FlareGridMaterial('centroid')
    this.gridFluxPass = new ShaderPass(this.gridFluxMaterial)
    this.gridCentroidPass = new ShaderPass(this.gridCentroidMaterial)
    this.selectFluxMaterial = new FlareSelectMaterial('flux', this.gridCentroidTarget.texture)
    this.selectCentroidMaterial = new FlareSelectMaterial('centroid', this.gridCentroidTarget.texture)
    this.selectFluxPass = new ShaderPass(this.selectFluxMaterial)
    this.selectCentroidPass = new ShaderPass(this.selectCentroidMaterial)

    this.ghostTarget = createHalfFloatTarget('LensFlare.Ghosts')
    this.ghostGeometry = createSpriteQuad()
    this.ghostMaterial = new FlareGhostMaterial(
      { ghostAmount: shared.ghostAmount, intensity: shared.intensity },
      this.sourceFluxTarget.texture,
      this.sourceCentroidTarget.texture
    )
    const ghostMesh = new Mesh(this.ghostGeometry, this.ghostMaterial)
    ghostMesh.frustumCulled = false
    this.ghostScene.add(ghostMesh)

    this.starburstGeometry = createSpriteQuad()
    this.starburstMaterial = new FlareStarburstMaterial(
      { starburstAmount: shared.starburstAmount, intensity: shared.intensity },
      this.sourceFluxTarget.texture,
      this.sourceCentroidTarget.texture
    )
    const starburstMesh = new Mesh(this.starburstGeometry, this.starburstMaterial)
    starburstMesh.frustumCulled = false
    this.starburstScene.add(starburstMesh)

    this.uniforms.get('ghostBuffer').value = this.ghostTarget.texture
    this.uniforms.get('starburstBuffer').value = this.renderTarget2.texture
    this.uniforms.get('streakBuffer').value = this.streakTarget.texture

    this.resolution = new Resolution(this, resolutionX, resolutionY, resolutionScale)
    this.resolution.addEventListener('change', this.onResolutionChange)

    this.ghostVignette = ghostVignette
    this.ghostChromatic = ghostChromatic
    this.starburstMinFlux = starburstMinFlux
    if (thresholdLevel !== undefined) this.thresholdLevel = thresholdLevel
    if (streakThreshold !== undefined) this.streakMaterial.streakThreshold = streakThreshold
    if (streakScale !== undefined) this.streakMaterial.streakScale = streakScale
    if (streakTint !== undefined) this.streakMaterial.streakTint.set(streakTint[0], streakTint[1], streakTint[2])
    if (streakSourceCeiling !== undefined) this.streakMaterial.streakSourceCeiling = streakSourceCeiling
  }

  private readonly onResolutionChange = (): void => {
    this.setSize(this.resolution.baseWidth, this.resolution.baseHeight)
  }

  override initialize(renderer: WebGLRenderer, alpha: boolean, frameBufferType: TextureDataType): void {
    for (const pass of [
      this.thresholdPass,
      this.preBlurPass,
      this.localContrastPass,
      this.streakSourcePass,
      this.streakPass,
      this.gridFluxPass,
      this.gridCentroidPass,
      this.selectFluxPass,
      this.selectCentroidPass
    ]) {
      pass.initialize(renderer, alpha, frameBufferType)
    }
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, _deltaTime?: number): void {
    this.thresholdPass.render(renderer, inputBuffer, this.renderTarget1)
    this.preBlurPass.render(renderer, this.renderTarget1, this.renderTarget2)

    // Нулевой штрих — Kawase-источник и 129 выборок на пиксель не платятся
    if (this.streakAmount !== 0) {
      this.streakSourcePass.render(renderer, this.renderTarget2, this.streakSourceTarget)
      this.streakPass.render(renderer, this.streakSourceTarget, this.streakTarget)
    }

    this.localContrastPass.render(renderer, this.renderTarget2, this.renderTarget1)

    const ghosts = this.ghostAmount !== 0
    const starburst = this.starburstAmount !== 0
    if (!ghosts && !starburst) return

    this.gridFluxPass.render(renderer, this.renderTarget1, this.gridFluxTarget)
    this.gridCentroidPass.render(renderer, this.renderTarget1, this.gridCentroidTarget)
    this.selectFluxPass.render(renderer, this.gridFluxTarget, this.sourceFluxTarget)
    this.selectCentroidPass.render(renderer, this.gridFluxTarget, this.sourceCentroidTarget)

    if (ghosts) this.renderSprites(renderer, this.ghostScene, this.ghostTarget)
    // renderTarget2 после локального контраста свободен
    if (starburst) this.renderSprites(renderer, this.starburstScene, this.renderTarget2)
  }

  /** Спрайты сложением в очищенный таргет; состояние очистки рендерера возвращается */
  private renderSprites(renderer: WebGLRenderer, scene: Scene, target: WebGLRenderTarget): void {
    const autoClear = renderer.autoClear
    renderer.getClearColor(this.clearColor)
    const clearAlpha = renderer.getClearAlpha()

    renderer.autoClear = false
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, false, false)
    renderer.render(scene, this.spriteCamera)

    renderer.setClearColor(this.clearColor, clearAlpha)
    renderer.autoClear = autoClear
  }

  override setSize(baseWidth: number, baseHeight: number): void {
    const resolution = this.resolution
    resolution.setBaseSize(baseWidth, baseHeight)

    const { width, height } = resolution
    this.renderTarget1.setSize(width, height)
    this.renderTarget2.setSize(width, height)
    this.thresholdMaterial.setSize(width, height)
    this.preBlurPass.setSize(width, height)
    this.localContrastMaterial.setSize(width, height)

    // Четверть базового разрешения: штрих и призраки — мягкие, мелких деталей нет
    const quarterWidth = Math.max(1, width >> 1)
    const quarterHeight = Math.max(1, height >> 1)
    this.streakSourceTarget.setSize(quarterWidth, quarterHeight)
    this.streakSourcePass.setSize(quarterWidth, quarterHeight)
    this.streakTarget.setSize(quarterWidth, quarterHeight)
    this.streakMaterial.setSize(quarterWidth, quarterHeight)
    this.ghostTarget.setSize(quarterWidth, quarterHeight)

    // Сетка: строки фиксированы, столбцы — по аспекту кадра
    this.gridSize = flareGridSize(width, height)
    const { cols, rows } = this.gridSize
    for (const target of [this.gridFluxTarget, this.gridCentroidTarget, this.sourceFluxTarget, this.sourceCentroidTarget]) {
      target.setSize(cols, rows)
    }
    this.gridFluxMaterial.setSize(width, height, cols, rows)
    this.gridCentroidMaterial.setSize(width, height, cols, rows)
    this.selectFluxMaterial.setGrid(cols, rows)
    this.selectCentroidMaterial.setGrid(cols, rows)

    const aspect = width > 0 && height > 0 ? width / height : 1
    this.ghostMaterial.setGrid(cols, rows, aspect)
    this.starburstMaterial.setGrid(cols, rows, aspect)
    this.ghostGeometry.instanceCount = cols * rows * FLARE_GHOSTS.length
    this.starburstGeometry.instanceCount = cols * rows
  }

  override dispose(): void {
    super.dispose()
    // Геометрии в обход Effect.dispose не попадают — он разбирает только
    // Texture/Material/WebGLRenderTarget/Pass
    this.ghostGeometry.dispose()
    this.starburstGeometry.dispose()
  }

  get intensity(): number {
    return this.uniforms.get('intensity').value
  }

  set intensity(value: number) {
    this.uniforms.get('intensity').value = value
  }

  get ghostAmount(): number {
    return this.uniforms.get('ghostAmount').value
  }

  set ghostAmount(value: number) {
    this.uniforms.get('ghostAmount').value = value
  }

  get starburstAmount(): number {
    return this.uniforms.get('starburstAmount').value
  }

  set starburstAmount(value: number) {
    this.uniforms.get('starburstAmount').value = value
  }

  get streakAmount(): number {
    return this.uniforms.get('streakAmount').value
  }

  set streakAmount(value: number) {
    this.uniforms.get('streakAmount').value = value
  }

  get ghostVignette(): number {
    return this.ghostMaterial.ghostVignette
  }

  set ghostVignette(value: number) {
    this.ghostMaterial.ghostVignette = value
  }

  get ghostChromatic(): number {
    return this.ghostMaterial.ghostChromatic
  }

  set ghostChromatic(value: number) {
    this.ghostMaterial.ghostChromatic = value
  }

  get starburstMinFlux(): number {
    return this.starburstMaterial.starburstMinFlux
  }

  set starburstMinFlux(value: number) {
    this.starburstMaterial.starburstMinFlux = value
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
