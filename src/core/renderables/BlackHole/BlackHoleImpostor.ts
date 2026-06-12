import { DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, ShaderMaterial, SphereGeometry } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { Actor } from '@/core/models/Actor'
import { timeStore } from '@/ui/mobx/TimeStore'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { BlackHoleNoiseTexture } from '@/core/renderables/BlackHole/BlackHoleNoiseTexture'
import {
  BlackHoleImpostorShaderTemplate,
  createBlackHoleImpostorUniforms
} from '@/core/renderables/BlackHole/BlackHoleImpostorShaderTemplate'

/**
 * Чёрная дыра, уровень L1 (импостор, спецификация §8)
 *
 * Состав: чёрная сфера радиусом тени (√27/2 · rsVisual) + плоское кольцо
 * диска с blackbody-профилем, идентичным L0. Лензирование не считается —
 * на пороговом экранном размере (~35 px) оно неразличимо, и это критерий
 * правильно выбранного порога переключения.
 *
 * У «голой» дыры (temperature = 0) кольцо не создаётся — остаётся только
 * чёрный силуэт тени на фоне звёзд
 */
class BlackHoleImpostor extends Group {
  public model: Actor
  public readonly parameters: BlackHoleParameters

  private ringMaterial: ShaderMaterial | null = null

  public constructor(model: Actor, parameters: BlackHoleParameters) {
    super()
    this.model = model
    this.parameters = parameters

    this.__setup()
  }

  __setup(): void {
    this.name = this.model.getAttribute('name') + 'BlackHoleImpostor'

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

  public updateObject(delta?: number): void {
    if (!this.ringMaterial) return

    // та же свёртка эпохи, что у L0 (см. BlackHoleMaterial.update, шаг 7) —
    // фаза вращения диска непрерывна при переключении LOD
    const wrap: number = this.parameters.rotationPeriod * 16384
    this.ringMaterial.uniforms.uTime.value = timeStore.epoch - Math.floor(timeStore.epoch / wrap) * wrap
  }
}

export { BlackHoleImpostor }
