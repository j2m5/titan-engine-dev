import { Camera, Mesh, Scene, SphereGeometry, Texture, Vector2, Vector3, WebGLRenderer } from 'three'
import { DEPTH_VOLUME_LAYER, DepthVolume } from '@/core/graphic/passes/DepthVolume'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { Disposable } from '@/core/lifecycle/Disposable'
import { UpdateContext } from '@/core/UpdateContext'
import { PulsarBeamsMaterial } from '@/core/renderables/Pulsar/PulsarBeamsMaterial'
import { PulsarParameters } from '@/core/renderables/Pulsar/PulsarParameters'
import { beamPhaseAt, magneticAxisAt } from '@/core/renderables/Pulsar/beamKinematics'

/** Запас прокси-сферы над длиной луча: кромка конуса на полуугле не срезается сферой */
const PROXY_PADDING = 1.05

/**
 * Объём лучей-маяка пульсара: ребёнок узла пульсара, свой кватернион — полюс
 * оси вращения (ставит фабрика); в локальном кадре +Y — ось вращения,
 * магнитная ось крутится вокруг неё по симуляционному времени.
 */
class PulsarBeams extends Mesh implements DepthVolume, Disposable {
  declare public material: PulsarBeamsMaterial
  public readonly boundingRadius: number

  private static readonly _cameraWorld = new Vector3()
  private readonly params: PulsarParameters
  private readonly registry: DepthVolumeRegistry | null

  public constructor(params: PulsarParameters, registry: DepthVolumeRegistry | null) {
    super(new SphereGeometry(params.beamLengthUnits * PROXY_PADDING, 32, 16), new PulsarBeamsMaterial())
    this.params = params
    this.registry = registry
    this.boundingRadius = params.beamLengthUnits * PROXY_PADDING
    this.frustumCulled = false
    this.layers.set(DEPTH_VOLUME_LAYER)

    const u = this.material.uniforms
    u.uHalfAngle.value = params.beamHalfAngleRad
    u.uLength.value = params.beamLengthUnits
    u.uColor.value.copy(params.beamColor)
    u.uIntensity.value = params.beamIntensity

    // Матрицы и камера — в onBeforeRender: там они актуальны для ЭТОГО кадра
    // (SceneManager.update идёт после рендера, обновление там отстаёт на кадр)
    this.onBeforeRender = (_renderer: WebGLRenderer, _scene: Scene, camera: Camera): void => {
      u.uInvModelMatrix.value.copy(this.matrixWorld).invert()
      camera.getWorldPosition(PulsarBeams._cameraWorld)
      u.uCameraLocal.value.copy(PulsarBeams._cameraWorld).applyMatrix4(u.uInvModelMatrix.value)
    }

    this.registry?.register(this)
  }

  public updateObject(ctx: UpdateContext): void {
    const phase = beamPhaseAt(ctx.epoch, this.params.beamPeriodSeconds, this.params.beamPhaseRad)
    magneticAxisAt(phase, this.params.beamTiltRad, this.material.uniforms.uAxis.value as Vector3)
  }

  public bindSceneDepth(sceneDepth: Texture, resolution: Vector2, logFarFactor: number): void {
    const u = this.material.uniforms
    u.uSceneDepth.value = sceneDepth
    u.uResolution.value.copy(resolution)
    u.uLogFarFactor.value = logFarFactor
    u.uSceneDepthEnabled.value = 1
  }

  public unbindSceneDepth(): void {
    this.material.uniforms.uSceneDepthEnabled.value = 0
  }

  public dispose(): void {
    this.registry?.unregister(this)
    this.geometry.dispose()
    this.material.dispose()
  }
}

export { PulsarBeams }
