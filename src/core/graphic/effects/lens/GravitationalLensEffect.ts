import { Effect, EffectAttribute, EffectPass } from 'postprocessing'
import { Matrix3, PerspectiveCamera, Uniform, Vector3, WebGLRenderTarget, WebGLRenderer } from 'three'
import { createSkyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { buildGravitationalLensFragment, LENS_SLOTS } from '@/core/graphic/effects/lens/gravitationalLensShader'
import type { LensRegistry } from '@/core/services/LensRegistry'

/**
 * Экранный проход дальнего поля гравитационной линзы: сдвигает готовый кадр
 * снаружи меша сильной зоны чёрной дыры (см. gravitationalLensShader.ts).
 * Свой EffectPass сразу за DepthVolumePass: читает соседние пиксели
 * (CONVOLUTION) и глубину, а лензировать должен уже и объёмы.
 */
export class GravitationalLensEffect extends Effect {
  private readonly camera: PerspectiveCamera
  private readonly registry: LensRegistry
  private readonly cameraWorld = new Vector3()
  private readonly center = new Vector3()
  private readonly viewRotation = new Matrix3()
  private filled = 0

  public constructor(camera: PerspectiveCamera, registry: LensRegistry) {
    const uniforms = new Map<string, Uniform>([
      ['uCount', new Uniform(0)],
      ['uCenterView', new Uniform(Array.from({ length: LENS_SLOTS }, () => new Vector3()))],
      ['uRs', new Uniform(new Array<number>(LENS_SLOTS).fill(1))],
      ['uSimRadius', new Uniform(new Array<number>(LENS_SLOTS).fill(0))],
      ['uProjection', new Uniform(camera.projectionMatrix)],
      ['uProjectionInverse', new Uniform(camera.projectionMatrixInverse)],
      ['uCameraWorldMatrix', new Uniform(camera.matrixWorld)],
      ['uLogFarFactor', new Uniform(Math.log2(camera.far + 1))],
      ['skybox', new Uniform(null)]
    ])
    for (const [name, uniform] of Object.entries(createSkyboxSampleUniforms())) {
      uniforms.set(name, new Uniform(uniform.value))
    }

    super('GravitationalLensEffect', buildGravitationalLensFragment(), {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms
    })

    this.camera = camera
    this.registry = registry
  }

  /** Линз в кадре после последнего update */
  public get lensCount(): number {
    return this.filled
  }

  public override update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, _deltaTime?: number): void {
    const camera = this.camera
    this.uniforms.get('uProjection')!.value = camera.projectionMatrix
    this.uniforms.get('uProjectionInverse')!.value = camera.projectionMatrixInverse
    this.uniforms.get('uCameraWorldMatrix')!.value = camera.matrixWorld
    this.uniforms.get('uLogFarFactor')!.value = Math.log2(camera.far + 1)

    this.cameraWorld.setFromMatrixPosition(camera.matrixWorld)
    this.viewRotation.setFromMatrix4(camera.matrixWorldInverse)

    const centers = this.uniforms.get('uCenterView')!.value as Vector3[]
    const rs = this.uniforms.get('uRs')!.value as number[]
    const radii = this.uniforms.get('uSimRadius')!.value as number[]
    let count = 0
    // Кадр без линз не держит кубмапу: после смены сценария она разобрана,
    // и живая ссылка заставила бы three заново грузить её каждый кадр
    this.uniforms.get('skybox')!.value = null

    for (const entry of this.registry.entries()) {
      if (count >= LENS_SLOTS) break
      // Импостор активен — меш L0 невидим, сильной зоны в кадре нет, линза выключена
      if (!entry.object.visible) continue
      // Центр относительно камеры в float64, затем только поворот в вид
      entry.object.getWorldPosition(this.center)
      this.center.sub(this.cameraWorld).applyMatrix3(this.viewRotation)
      // Камера внутри сферы: весь экран рисует шейдер дыры
      if (this.center.length() < entry.simulationRadiusUnits) continue

      centers[count].copy(this.center)
      rs[count] = entry.rsUnits
      radii[count] = entry.simulationRadiusUnits
      if (count === 0) this.uniforms.get('skybox')!.value = entry.background()
      count++
    }

    this.filled = count
    this.uniforms.get('uCount')!.value = count
  }
}

export function createGravitationalLensPass(camera: PerspectiveCamera, registry: LensRegistry): EffectPass {
  return new EffectPass(camera, new GravitationalLensEffect(camera, registry))
}
