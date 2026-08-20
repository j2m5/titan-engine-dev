import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer
} from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import { UpdateContext } from '@/core/UpdateContext'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { BlackHoleNoiseTexture } from '@/core/renderables/BlackHole/BlackHoleNoiseTexture'
import { config } from '@/core/framework/config'
import { worldSizeForPixels } from '@/core/helpers/apparentSize'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import {
  BlackHoleImpostorShaderTemplate,
  createBlackHoleImpostorUniforms
} from '@/core/renderables/BlackHole/BlackHoleImpostorShaderTemplate'

/**
 * Чёрная дыра, уровень L1 (импостор, спецификация §8)
 *
 * Состав: чёрная сфера радиусом тени (√27/2 · rsVisual) + плоское кольцо
 * диска с blackbody-профилем, идентичным L0. Лензирование не считается —
 * на пороговом экранном размере (~45 px) оно неразличимо, и это критерий
 * правильно выбранного порога переключения.
 *
 * У «голой» дыры (temperature = 0) кольцо не создаётся — остаётся только
 * чёрный силуэт тени на фоне звёзд
 *
 * Видимый размер снизу ограничен полом blackHole.impostorPixels — той же
 * конвенцией, что у звёздных импосторов: дыра с диском не сжимается ниже
 * этого размера и держит полную яркость, поэтому издалека продолжает
 * блумить, а не тает вместе с субпиксельным кольцом. Голая дыра пола не
 * получает: светить нечему, а тень крупнее физической — это дыра в фоне.
 */
class BlackHoleImpostor extends Group {
  public model: Actor
  public readonly parameters: BlackHoleParameters

  private ringMaterial: ShaderMaterial | null = null

  private readonly worldPosition: Vector3 = new Vector3()
  private readonly cameraPosition: Vector3 = new Vector3()

  public constructor(
    model: Actor,
    parameters: BlackHoleParameters,
    private readonly renderer: WebGLRenderer
  ) {
    super()
    this.model = model
    this.parameters = parameters

    this.__setup()
  }

  __setup(): void {
    this.name = this.model.getAttribute('name', '') + 'BlackHoleImpostor'

    // ── Тень: чёрная сфера читается как чёрный круг с любого ракурса,
    // без билбординга; перекрывает фон и пишет глубину штатным пайплайном ──
    const shadow: Mesh = new Mesh(
      new SphereGeometry(this.parameters.shadowRadiusUnits, 24, 16),
      new MeshBasicMaterial({ color: 0x000000 })
    )
    shadow.name = this.name + 'Shadow'
    shadow.userData.type = 'blackHole'
    shadow.userData.clickable = true
    this.add(shadow)

    // ── Кольцо диска (только при temperature > 0) ──
    if (this.parameters.hasDisk) {
      this.ringMaterial = new ShaderMaterial({
        ...BlackHoleImpostorShaderTemplate,
        uniforms: createBlackHoleImpostorUniforms(this.parameters),

        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        depthTest: true
      })
      this.ringMaterial.name = 'BlackHoleImpostorMaterial'

      // та же общая noise-текстура и тот же seed-сдвиг UV, что у L0 —
      // совпадение структуры диска на переключении LOD
      this.ringMaterial.uniforms.noiseMap.value = BlackHoleNoiseTexture.get()
      const seed: number = this.parameters.diskNoiseSeed
      this.ringMaterial.uniforms.uNoiseOffset.value.set(
        seed * 0.7548776662 - Math.floor(seed * 0.7548776662),
        seed * 0.5698402909 - Math.floor(seed * 0.5698402909)
      )

      const ring: Mesh = new Mesh(
        new RingGeometry(
          (this.parameters.diskInnerRadius / this.parameters.rsVisual) * this.parameters.rsVisualUnits,
          (this.parameters.diskOuterRadius / this.parameters.rsVisual) * this.parameters.rsVisualUnits,
          96,
          1
        ),
        this.ringMaterial
      )

      // RingGeometry лежит в XY (нормаль +Z); поворот к плоскости диска L0
      // с нормалью (0, cos t, sin t): rotation.x = tilt − π/2 (выведено
      // из матрицы поворота вокруг X). Локальные координаты шейдера (vLocal)
      // берутся ДО поворота — азимут согласован с tangentX базиса L0
      ring.rotation.x = degToRad(this.parameters.axialTilt) - Math.PI / 2
      ring.name = this.name + 'Ring'
      ring.userData.type = 'blackHole'
      ring.userData.clickable = true
      this.add(ring)
    }
  }

  public updateObject(ctx: UpdateContext): void {
    if (!this.ringMaterial) return

    this.__applySizeFloor(ctx)

    // та же свёртка эпохи, что у L0 (см. BlackHoleMaterial.update, шаг 7) —
    // фаза вращения диска непрерывна при переключении LOD
    const wrap: number = this.parameters.rotationPeriod * 16384
    this.ringMaterial.uniforms.uTime.value = ctx.epoch - Math.floor(ctx.epoch / wrap) * wrap
  }

  /**
   * Пол видимого размера: ниже blackHole.impostorPixels дыра рисуется
   * увеличенной, но с прежней (полной) яркостью — конвенция звёздных
   * импосторов, см. FakeStar.updateObject.
   *
   * Меряется диаметр зоны симуляции — та же величина, по которой BlackHoleLod
   * выбирает дистанцию переключения. Пока настоящий размер выше пола, масштаб
   * ровно 1, поэтому на стыке LOD не меняется ничего.
   *
   * Позиция мировая, а не локальная: импостор висит в нуле родительского узла,
   * и по локальной мерилось бы расстояние до начала сцены. Ту же величину
   * меряет LOD.update, выбирая уровень
   */
  private __applySizeFloor(ctx: UpdateContext): void {
    const cameraPosition: Vector3 = ctx.camera.getWorldPosition(this.cameraPosition)
    const distance: number = this.getWorldPosition(this.worldPosition).distanceTo(cameraPosition)

    const trueSize: number = toThreeJSUnits(2 * this.parameters.simulationRadius)
    const floorSize: number = worldSizeForPixels(
      config('blackHole.impostorPixels'),
      distance,
      ctx.camera.fov,
      this.renderer.domElement.height
    )

    this.scale.setScalar(Math.max(1, floorSize / trueSize))
  }
}

export { BlackHoleImpostor }
