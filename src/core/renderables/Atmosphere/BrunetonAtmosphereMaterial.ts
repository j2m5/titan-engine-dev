/**
 * BrunetonAtmosphereMaterial.ts
 *
 * Material wrapper for the parametric Bruneton atmospheric scattering shader.
 * Accepts any AtmosphereConfig — not limited to Earth.
 *
 * === USAGE ===
 *
 *   import { EARTH_ATMOSPHERE } from './AtmosphereConfig'
 *   import { AtmosphereLUTGenerator } from './AtmosphereLUTGenerator'
 *
 *   // Generate LUTs for the planet
 *   const lutGenerator = new AtmosphereLUTGenerator(renderer)
 *   const luts = lutGenerator.generate(EARTH_ATMOSPHERE)
 *
 *   // Create material
 *   const material = new BrunetonAtmosphereMaterial()
 *   material.setAtmosphereConfig(EARTH_ATMOSPHERE)
 *   material.bindLUTTextures(luts)
 *
 *   // Create mesh (topRadius from config, converted to Three.js units)
 *   const geometry = new SphereGeometry(toThreeJSUnits(EARTH_ATMOSPHERE.topRadius), 64, 64)
 *   const atmosphereMesh = new Mesh(geometry, material)
 *   planet.add(atmosphereMesh)
 *
 *   // Each frame:
 *   material.update(atmosphereMesh, camera, starWorldPosition)
 *
 * ВАЖНО: setAtmosphereConfig сбрасывает exposure/hdrKnee к дефолтам, если
 * переданный конфиг их не содержит — передавайте поля явно.
 */

import {
  RawShaderMaterial,
  DoubleSide,
  CustomBlending,
  OneFactor,
  SrcColorFactor,
  ZeroFactor,
  GLSL3,
  Mesh,
  PerspectiveCamera,
  Vector3,
  Vector2,
  Matrix4,
  Uniform
} from 'three'
import { BrunetonAtmosphereShaderTemplate } from './BrunetonAtmosphereShaderTemplate'
import { AtmosphereConfig, createAtmosphereUniforms, updateAtmosphereUniforms } from './AtmosphereConfig'
import { AtmosphereLUTs } from './AtmosphereLUTGenerator'
import { IUniform } from 'three/src/renderers/shaders/UniformsLib'
import { Actor } from '@/core/models/Actor'
import { requireRenderingData } from '@/core/helpers/renderingData'

/**
 * Проход композиции атмосферы. Формула `dst × transmittance + inScatter`
 * не влезает в один RGBA-выход (RGB заняты in-scatter, альфа — скаляр),
 * поэтому раскладывается на два прохода блендинга одного меша.
 */
enum AtmospherePass {
  InScatter,
  Transmittance
}

/**
 * Deep-clone a uniforms object so each material instance owns independent
 * Uniform objects. Without this, spread ({...uniforms}) creates a shallow
 * copy where all instances share the same Uniform references — writing to
 * one material's uniform silently overwrites every other material's value.
 */
function cloneUniforms(src: { [uniform: string]: IUniform }): { [uniform: string]: IUniform } {
  const dst: { [uniform: string]: IUniform } = {}
  for (const key in src) {
    const v = src[key].value
    if (v === null || v === undefined) {
      dst[key] = new Uniform(v)
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      dst[key] = new Uniform(v)
    } else if (v.isVector2) {
      dst[key] = new Uniform(v.clone())
    } else if (v.isVector3) {
      dst[key] = new Uniform(v.clone())
    } else if (v.isMatrix4) {
      dst[key] = new Uniform(v.clone())
    } else if (v instanceof Float32Array) {
      dst[key] = new Uniform(new Float32Array(v))
    } else {
      dst[key] = new Uniform(v)
    }
  }
  return dst
}

class BrunetonAtmosphereMaterial extends RawShaderMaterial {
  private _invModelMatrix = new Matrix4()
  private _localCameraPos = new Vector3()
  private _localSunDir = new Vector3()

  /**
   * Конфиг атмосферы актора: форма `renderingObject.data` утверждается здесь,
   * в одном месте на весь класс. Отсутствие конфига — баг данных: атмосферу без
   * параметров не построить, а `createAtmosphereUniforms` разыменовывает поля сразу.
   */
  private static __config(model: Actor): AtmosphereConfig {
    return requireRenderingData<AtmosphereConfig>(model, 'BrunetonAtmosphereMaterial')
  }

  public constructor(model: Actor, pass: AtmospherePass = AtmospherePass.InScatter) {
    super({
      glslVersion: GLSL3,
      uniforms: cloneUniforms({
        ...BrunetonAtmosphereShaderTemplate.uniforms,
        ...createAtmosphereUniforms(BrunetonAtmosphereMaterial.__config(model))
      }),
      vertexShader: BrunetonAtmosphereShaderTemplate.vertexShader,
      fragmentShader: BrunetonAtmosphereShaderTemplate.fragmentShader,
      defines: pass === AtmospherePass.Transmittance ? { ATMOSPHERE_PASS_TRANSMITTANCE: '1' } : {},

      side: DoubleSide,
      transparent: true,
      depthWrite: false,

      // Проход A множит кадр на пропускание (Zero/SrcColor), проход B
      // добавляет in-scatter (One/One). Альфа-факторы Zero/One у обоих:
      // альфа целевого буфера композицию больше не несёт и не трогается.
      blending: CustomBlending,
      blendSrc: pass === AtmospherePass.Transmittance ? ZeroFactor : OneFactor,
      blendDst: pass === AtmospherePass.Transmittance ? SrcColorFactor : OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor
    })

    // sun_size зависит от углового радиуса звезды конкретной планеты —
    // дефолт шаблона земной, без этого диск солнца рисуется неверного размера
    const config: AtmosphereConfig = BrunetonAtmosphereMaterial.__config(model)
    this.uniforms.sun_size.value.set(Math.tan(config.sunAngularRadius), Math.cos(config.sunAngularRadius))

    // Пер-планетные ручки пересвета (спека 2026-07-31): нейтральные дефолты —
    // атмосфера без полей (Земля) рендерится бит-в-бит как раньше
    this.uniforms.exposure.value = config.exposure ?? 10.0
    this.uniforms.uHdrKnee.value = Math.max(0, config.hdrKnee ?? 1.0)
  }

  /**
   * Configure atmosphere parameters for a specific planet.
   * This updates all atmosphere-related uniforms in the shader.
   *
   * IMPORTANT: The LUT textures must have been precomputed with
   * the SAME config via AtmosphereLUTGenerator.generate(config).
   * Parameters and LUTs must match — mismatches produce artifacts.
   */
  public setAtmosphereConfig(config: AtmosphereConfig): void {
    updateAtmosphereUniforms(this.uniforms, config)

    // Update sun_size based on config's angular radius
    this.uniforms.sun_size.value = new Vector2(Math.tan(config.sunAngularRadius), Math.cos(config.sunAngularRadius))

    this.uniforms.exposure.value = config.exposure ?? 10.0
    this.uniforms.uHdrKnee.value = Math.max(0, config.hdrKnee ?? 1.0)
  }

  /**
   * Bind precomputed LUT textures.
   * Accepts either the result of AtmosphereLUTGenerator.generate()
   * or a Map from the legacy DTLoader.
   */
  public bindLUTTextures(luts: AtmosphereLUTs): void {
    this.uniforms.transmittance_texture.value = luts.transmittance
    this.uniforms.scattering_texture.value = luts.scattering
    this.uniforms.irradiance_texture.value = luts.irradiance
    this.uniforms.single_mie_scattering_texture.value = luts.scattering
  }

  /**
   * Связать проходы одной атмосферы общим объектом uniforms.
   *
   * Намеренное нарушение принципа `cloneUniforms`: тот защищает от случайного
   * шаринга между РАЗНЫМИ планетами, здесь же оба прохода описывают ОДНУ
   * атмосферу и обязаны видеть одинаковые пер-кадровые величины
   * (localCameraPos, localSunDir, logDepthBufFC) и одинаковые LUT — иначе
   * между проходами появится видимая кромка. Побочный эффект приятный:
   * `update()` достаточно звать на одном материале.
   */
  public shareUniformsWith(other: BrunetonAtmosphereMaterial): void {
    this.uniforms = other.uniforms
  }

  /**
   * Update per-frame uniforms.
   */
  public update(mesh: Mesh, camera: PerspectiveCamera, lightPosition: Vector3): void {
    const mw = mesh.matrixWorld.elements
    const cw = camera.matrixWorld.elements

    // Матрицы для gl_Position (modelViewMatrix/projectionMatrix) заливает сам
    // рендерер — см. комментарий в BrunetonAtmosphereShaderTemplate.
    // Здесь обновляется только то, что несёт точность: локальные позиция
    // камеры и направление на солнце, посчитанные в float64 на CPU.

    // ── 1. Local camera position ──
    // = inverse(originalModelMatrix) * cameraWorldPosition
    this._invModelMatrix.copy(mesh.matrixWorld).invert()

    this._localCameraPos.set(cw[12], cw[13], cw[14]) // camera world pos
    this._localCameraPos.applyMatrix4(this._invModelMatrix)
    this.uniforms.localCameraPos.value.copy(this._localCameraPos)

    // ── 2. Local sun direction ──
    // worldSunDir = normalize(lightPosition - meshWorldCenter)
    this._localSunDir.set(lightPosition.x - mw[12], lightPosition.y - mw[13], lightPosition.z - mw[14]).normalize()
    // Transform direction to local space (w=0 equivalent)
    this._localSunDir.transformDirection(this._invModelMatrix)
    this.uniforms.localSunDir.value.copy(this._localSunDir)

    // ── 3. Log depth (рендерер заливает logDepthBufFC только при включённом
    // logarithmicDepthBuffer — ручной сет нужен для сцен без этого флага) ──
    const far = camera.far ?? 1e10
    this.uniforms.logDepthBufFC.value = 2.0 / (Math.log(far + 1.0) / Math.LN2)
  }

  // ─── Convenience accessors ───────────────────────────────────

  public set exposure(value: number) {
    this.uniforms.exposure.value = value
  }

  public get exposure(): number {
    return this.uniforms.exposure.value
  }

  public setWhitePoint(r: number, g: number, b: number): void {
    this.uniforms.white_point.value.set(r, g, b)
  }

  public set inverseSpaceScale(value: number) {
    this.uniforms.inverseSpaceScale.value = value
  }

  public get inverseSpaceScale(): number {
    return this.uniforms.inverseSpaceScale.value
  }
}

export { AtmospherePass, BrunetonAtmosphereMaterial }
