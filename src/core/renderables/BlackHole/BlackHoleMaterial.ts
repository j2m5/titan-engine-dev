import { BackSide, CubeTexture, GLSL3, Matrix4, Mesh, PerspectiveCamera, RawShaderMaterial, Vector3 } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { BlackHoleNoiseTexture } from '@/core/renderables/BlackHole/BlackHoleNoiseTexture'
import { BlackHoleShaderTemplate, createBlackHoleUniforms } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'

/**
 * Материал чёрной дыры (этапы 1–3)
 *
 * RawShaderMaterial + GLSL3 с собственными модельными матрицами:
 * camera-relative паттерн — трансляции вычитаются на CPU в float64,
 * в шейдер попадают малые числа (uniforms названы crModelViewMatrix /
 * crProjectionMatrix — зарезервированные имена перезаписываются рендерером)
 *
 * Меш непрозрачен и пишет глубину — отдельный композитинг-пасс не нужен,
 * фон берётся из кубмапы сцены, Bloom/ACES обрабатывают дыру в общем пайплайне
 *
 * side: BackSide — камера может находиться внутри зоны симуляции
 */
class BlackHoleMaterial extends RawShaderMaterial {
  public readonly parameters: BlackHoleParameters

  private readonly _modelViewMatrix: Matrix4 = new Matrix4()
  private readonly _rotationOnlyView: Matrix4 = new Matrix4()
  private readonly _crModelMatrix: Matrix4 = new Matrix4()
  private readonly _localCameraPos: Vector3 = new Vector3()

  public constructor(parameters: BlackHoleParameters) {
    super({
      glslVersion: GLSL3,
      uniforms: createBlackHoleUniforms(parameters),
      vertexShader: BlackHoleShaderTemplate.vertexShader,
      fragmentShader: BlackHoleShaderTemplate.fragmentShader,

      side: BackSide,
      transparent: false,
      depthWrite: true,
      depthTest: true
    })

    this.parameters = parameters
    this.name = 'BlackHoleMaterial'

    // базис плоскости диска из axialTilt физического слоя; статичен —
    // меш не вращается, наклон живёт целиком в uniforms (см. BlackHole.__setup)
    const tiltRad: number = degToRad(parameters.axialTilt)
    const cos: number = Math.cos(tiltRad)
    const sin: number = Math.sin(tiltRad)
    this.uniforms.diskNormal.value.set(0, cos, sin)
    this.uniforms.diskTangentX.value.set(1, 0, 0)
    this.uniforms.diskTangentY.value.set(0, sin, -cos)

    // общая noise-текстура (одна на приложение) + seed-зависимое смещение UV
    this.uniforms.noiseMap.value = BlackHoleNoiseTexture.get()
    const seed: number = parameters.diskNoiseSeed
    this.uniforms.uNoiseOffset.value.set(
      seed * 0.7548776662 - Math.floor(seed * 0.7548776662),
      seed * 0.5698402909 - Math.floor(seed * 0.5698402909)
    )
  }

  /**
   * Покадровое обновление uniforms (вызывается из onBeforeRender —
   * матрицы камеры и меша гарантированно актуальны для текущего кадра)
   * @param mesh Меш bounding-сферы зоны симуляции
   * @param camera Камера сцены
   * @param background Фоновая кубмапа сцены (threeJS.scene.background)
   * @param epoch Эпоха симуляции (дни), кэшированная BlackHole.updateObject
   */
  public update(mesh: Mesh, camera: PerspectiveCamera, background: CubeTexture | null, epoch: number): void {
    const mw: number[] = mesh.matrixWorld.elements
    const cw: number[] = camera.matrixWorld.elements

    // ── 1. Camera-relative модельная матрица (трансляция в float64 на CPU) ──
    this._crModelMatrix.copy(mesh.matrixWorld)
    this._crModelMatrix.elements[12] = mw[12] - cw[12]
    this._crModelMatrix.elements[13] = mw[13] - cw[13]
    this._crModelMatrix.elements[14] = mw[14] - cw[14]

    // ── 2. Camera-relative modelViewMatrix (view без трансляции) ──
    this._rotationOnlyView.copy(camera.matrixWorldInverse)
    this._rotationOnlyView.elements[12] = 0
    this._rotationOnlyView.elements[13] = 0
    this._rotationOnlyView.elements[14] = 0

    this._modelViewMatrix.multiplyMatrices(this._rotationOnlyView, this._crModelMatrix)
    this.uniforms.crModelViewMatrix.value.copy(this._modelViewMatrix)

    // ── 3. Проекция без изменений ──
    this.uniforms.crProjectionMatrix.value.copy(camera.projectionMatrix)

    // ── 4. Позиция камеры в объектном пространстве меша (float64 на CPU) ──
    // меш не вращается и не масштабируется, поэтому достаточно вычитания трансляции
    this._localCameraPos.set(cw[12] - mw[12], cw[13] - mw[13], cw[14] - mw[14])
    this.uniforms.localCameraPos.value.copy(this._localCameraPos)

    // ── 5. Логарифмическая глубина ──
    const far: number = camera.far ?? 1e10
    this.uniforms.logDepthBufFC.value = 2.0 / (Math.log(far + 1.0) / Math.LN2)

    // ── 6. Фоновая кубмапа — физически тот же объект, что и scene.background ──
    // присваивание ссылки бесплатно; автоматически подхватит будущий процедурный фон
    this.uniforms.skybox.value = background

    // ── 7. Время диска: эпоха симуляции (дни), свёрнутая на CPU в float64 ──
    // по кратному периоду внутреннего края — фазы дифференциального вращения
    // не теряют точность в f32; диск ускоряется вместе со временем симуляции
    const wrap: number = this.parameters.rotationPeriod * 16384
    this.uniforms.uTime.value = epoch - Math.floor(epoch / wrap) * wrap
  }
}

export { BlackHoleMaterial }
