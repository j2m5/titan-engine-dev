import { BlendFunction, Effect, EffectAttribute, EffectPass } from 'postprocessing'
import { PerspectiveCamera, Uniform, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { SpaceScale } from '@/core/constants'
import { AtmosphereRegistry, AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { orderSlots } from '@/core/graphic/effects/atmosphere/atmosphereDepthMath'
import {
  ATMOSPHERE_SLOTS,
  buildAtmosphereEffectFragment,
  SLOT_PARAM_NAMES,
  slotUniformName
} from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import type { AtmosphereConfig, DensityProfileLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'

/** Оболочка мельче этого углового размера (top/dist, рад) в кадре не видна. */
const MIN_ANGULAR = 1e-5

/** Параметры слота типа vec3 — юниформы держат один Vector3 на всё время жизни. */
const SLOT_VEC3_PARAMS: readonly string[] = [
  'solar_irradiance',
  'rayleigh_scattering',
  'mie_scattering',
  'mie_extinction',
  'absorption_extinction',
  'ground_albedo'
]

/** Параметры слота типа float[5] (слои профиля плотности). */
const SLOT_LAYER_PARAMS: readonly string[] = [
  'rayleigh_layer0',
  'rayleigh_layer1',
  'mie_layer0',
  'mie_layer1',
  'absorption_layer0',
  'absorption_layer1'
]

/** Кандидат в слот: центр в км уже относительно камеры, направление на звезду — в мировых осях. */
interface SlotItem {
  entry: AtmosphereEntry
  centerKm: Vector3
  topRadiusKm: number
  sunDir: Vector3
}

/**
 * Атмосфера Брунетона как полноэкранный эффект по глубине сцены. Луч режется
 * реальной поверхностью (террейн, вода, луна перед планетой), а не
 * аналитическим дном; K оболочек композируются от дальней к ближней.
 * Живёт в СОБСТВЕННОМ EffectPass до HDR-прохода: блум считает яркость по
 * входу своего пасса и должен видеть уже затуманенный кадр.
 *
 * LUT принадлежат узлам BrunetonAtmosphere и лежат только в uniforms:
 * Effect.dispose() обходит поля экземпляра и освободил бы их.
 */
export class AtmosphereEffect extends Effect {
  private readonly camera: PerspectiveCamera
  private readonly registry: AtmosphereRegistry
  private filled = 0
  private warnedDropped = false

  private readonly cameraWorld = new Vector3()

  public constructor(camera: PerspectiveCamera, registry: AtmosphereRegistry, options: { debugView?: number } = {}) {
    const uniforms = new Map<string, Uniform>([
      ['uCount', new Uniform(0)],
      ['uCameraWorldMatrix', new Uniform(camera.matrixWorld)],
      ['uProjectionInverse', new Uniform(camera.projectionMatrixInverse)],
      ['uLogFarFactor', new Uniform(Math.log2(camera.far + 1))],
      ['uInverseSpaceScale', new Uniform(1 / SpaceScale)],
      ['uDebugView', new Uniform(options.debugView ?? 0)]
    ])

    // Значения юниформов создаются здесь и только заполняются в update:
    // fillSlot зовётся каждый кадр, аллокации в нём — мусор на GC
    for (let i = 0; i < ATMOSPHERE_SLOTS; i++) {
      for (const name of SLOT_PARAM_NAMES) {
        const value = SLOT_VEC3_PARAMS.includes(name)
          ? new Vector3()
          : SLOT_LAYER_PARAMS.includes(name)
            ? new Float32Array(5)
            : 0
        uniforms.set(slotUniformName(i, name), new Uniform(value))
      }
      uniforms.set(slotUniformName(i, 'transmittance'), new Uniform(null))
      uniforms.set(slotUniformName(i, 'scattering'), new Uniform(null))
      uniforms.set(slotUniformName(i, 'irradiance'), new Uniform(null))
      uniforms.set(slotUniformName(i, 'center'), new Uniform(new Vector3()))
      uniforms.set(slotUniformName(i, 'sunDir'), new Uniform(new Vector3(0, 0, 1)))
      uniforms.set(slotUniformName(i, 'sunSize'), new Uniform(new Vector2()))
      uniforms.set(slotUniformName(i, 'exposure'), new Uniform(1))
      uniforms.set(slotUniformName(i, 'hdrKnee'), new Uniform(1))
    }

    super('AtmosphereEffect', buildAtmosphereEffectFragment(), {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms
    })

    this.camera = camera
    this.registry = registry
  }

  public get slotCount(): number {
    return this.filled
  }

  public override update(_renderer: WebGLRenderer, _inputBuffer: WebGLRenderTarget, _deltaTime?: number): void {
    const camera = this.camera
    this.uniforms.get('uCameraWorldMatrix')!.value = camera.matrixWorld
    this.uniforms.get('uProjectionInverse')!.value = camera.projectionMatrixInverse
    this.uniforms.get('uLogFarFactor')!.value = Math.log2(camera.far + 1)

    this.cameraWorld.setFromMatrixPosition(camera.matrixWorld)

    // Кандидаты собираются заново каждый кадр: хранить их между кадрами значит
    // держать узлы и LUT удалённых сценариев живыми до смерти композера
    const items: SlotItem[] = this.registry.entries().map((entry) => {
      const centerWorld = new Vector3().setFromMatrixPosition(entry.object.matrixWorld)
      // Звезда в мировом (0,0,0): направление от центра оболочки к нулю СЦЕНЫ,
      // а не к камере — иначе освещённая сторона всегда смотрела бы в кадр
      const sunDir = centerWorld.clone().negate().normalize()
      // Центр относительно камеры в float64, затем юниты → км
      const centerKm = centerWorld.sub(this.cameraWorld).multiplyScalar(1 / SpaceScale)
      return { entry, centerKm, topRadiusKm: entry.config.topRadius, sunDir }
    })

    // filtered (мельче порога) в кадре не видны — про них молчим
    const { chosen, dropped } = orderSlots(items, ATMOSPHERE_SLOTS, MIN_ANGULAR)
    if (dropped.length > 0 && !this.warnedDropped) {
      console.warn(
        `AtmosphereEffect: видимых атмосфер больше, чем слотов (${ATMOSPHERE_SLOTS}) — не рисуются: ${dropped.map((e) => e.name).join(', ')}`
      )
      this.warnedDropped = true
    }

    chosen.forEach((slot, i) => {
      const item = items.find((it) => it.entry === slot.entry)!
      this.fillSlot(i, item)
    })
    this.clearSlotsFrom(chosen.length)
    this.filled = chosen.length
    this.uniforms.get('uCount')!.value = chosen.length
  }

  /** Пустые слоты не держат LUT ушедшего сценария живыми до смерти композера. */
  private clearSlotsFrom(from: number): void {
    for (let i = from; i < ATMOSPHERE_SLOTS; i++) {
      this.uniforms.get(slotUniformName(i, 'transmittance'))!.value = null
      this.uniforms.get(slotUniformName(i, 'scattering'))!.value = null
      this.uniforms.get(slotUniformName(i, 'irradiance'))!.value = null
    }
  }

  private fillSlot(i: number, item: SlotItem): void {
    const u = (name: string): Uniform => this.uniforms.get(slotUniformName(i, name))!
    const setVec3 = (name: string, v: readonly [number, number, number]): void => {
      ;(u(name).value as Vector3).set(v[0], v[1], v[2])
    }
    const setLayer = (name: string, layer: DensityProfileLayer): void => {
      const a = u(name).value as Float32Array
      a[0] = layer.width
      a[1] = layer.expTerm
      a[2] = layer.expScale
      a[3] = layer.linearTerm
      a[4] = layer.constantTerm
    }
    const entry = item.entry
    const c: AtmosphereConfig = entry.config

    setVec3('solar_irradiance', c.solarIrradiance)
    u('sun_angular_radius').value = c.sunAngularRadius
    u('bottom_radius').value = c.bottomRadius
    u('top_radius').value = c.topRadius
    setLayer('rayleigh_layer0', c.rayleighDensity[0])
    setLayer('rayleigh_layer1', c.rayleighDensity[1])
    setVec3('rayleigh_scattering', c.rayleighScattering)
    setLayer('mie_layer0', c.mieDensity[0])
    setLayer('mie_layer1', c.mieDensity[1])
    setVec3('mie_scattering', c.mieScattering)
    setVec3('mie_extinction', c.mieExtinction)
    u('mie_phase_function_g').value = c.miePhaseFunctionG
    setLayer('absorption_layer0', c.absorptionDensity[0])
    setLayer('absorption_layer1', c.absorptionDensity[1])
    setVec3('absorption_extinction', c.absorptionExtinction)
    setVec3('ground_albedo', c.groundAlbedo)
    u('mu_s_min').value = c.muSMin

    u('transmittance').value = entry.lut.transmittance
    u('scattering').value = entry.lut.scattering
    u('irradiance').value = entry.lut.irradiance
    ;(u('center').value as Vector3).copy(item.centerKm)
    ;(u('sunDir').value as Vector3).copy(item.sunDir)
    ;(u('sunSize').value as Vector2).set(Math.tan(c.sunAngularRadius), Math.cos(c.sunAngularRadius))
    u('exposure').value = c.exposure ?? 10
    // Колено ниже нуля инвертировало бы избыток над 1.0 (потемнение вместо сжатия)
    u('hdrKnee').value = Math.max(0, c.hdrKnee ?? 1)
  }
}

/** Пасс атмосферы: отдельный от HDR-прохода, см. докблок AtmosphereEffect. */
export function createAtmospherePass(
  camera: PerspectiveCamera,
  registry: AtmosphereRegistry,
  debugView: number
): EffectPass {
  return new EffectPass(camera, new AtmosphereEffect(camera, registry, { debugView }))
}
