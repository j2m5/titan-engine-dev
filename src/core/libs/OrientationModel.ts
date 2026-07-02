import { TOrientationModel } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { degToRad } from 'three/src/math/MathUtils'
import { Quaternion, Vector3 } from 'three'
import { J2000 } from '@/core/constants'
import { ASTRO_TO_THREE, THREE_TO_ASTRO } from '@/core/libs/frames'

const X_AXIS: Vector3 = new Vector3(1, 0, 0)
const Z_AXIS: Vector3 = new Vector3(0, 0, 1)

/**
 * Ориентация тела в пространстве: направление полюса + суточное вращение.
 *
 * Параметризация в духе IAU/WGCCRE, но в эклиптической системе J2000
 * (наш «астро»-фрейм, согласованный с орбитальными элементами):
 *   - ascendingNode — долгота узла экватора тела на эклиптике, градусы
 *   - inclination — наклон экватора тела к эклиптике, градусы
 *   - meridianAngle — угол W нулевого меридиана на эпоху J2000, градусы
 *   - period — сидерический период вращения, часы (всегда > 0)
 *   - direction — знак вращения: +1 прямое, -1 ретроградное
 *
 * Без строки rotation работает fallback из physicalObject:
 * наклон axialTilt вокруг мировой X (как легаси rotateX(-tilt)) + спин из rotationPeriod.
 */
class OrientationModel implements TOrientationModel {
  private readonly model: Actor

  public constructor(model: Actor) {
    this.model = model
  }

  private get hasRotationData(): boolean {
    return this.model.rotation !== null
  }

  public get meridianAngle(): number {
    return this.hasRotationData ? this.model.rotation!.getAttribute('meridianAngle', 0) : 0
  }

  public get ascendingNode(): number {
    return this.hasRotationData ? this.model.rotation!.getAttribute('ascendingNode', 0) : 180
  }

  public get inclination(): number {
    return this.hasRotationData
      ? this.model.rotation!.getAttribute('inclination', 0)
      : this.model.physicalObject?.getAttribute('axialTilt', 0)
  }

  /** Сидерический период вращения, часы */
  public get period(): number {
    return this.hasRotationData
      ? this.model.rotation!.getAttribute('period', 0)
      : this.model.physicalObject?.getAttribute('rotationPeriod', 0)
  }

  public get direction(): 1 | -1 {
    return this.hasRotationData ? this.model.rotation!.getAttribute('direction', 1) : 1
  }

  /** Угол нулевого меридиана W на заданную эпоху (JD, сутки), градусы */
  public getMeridianAngleByEpoch(epoch: number): number {
    if (!this.period) {
      return this.meridianAngle
    }

    const rotationsPerDay: number = 24 / this.period

    return this.meridianAngle + this.direction * 360 * rotationsPerDay * (epoch - J2000)
  }

  /**
   * Кватернион экваториальной рамки (наклон полюса без суточного вращения),
   * в координатах Three.js. Для колец и атмосфер: они лежат в плоскости
   * экватора, но не должны вращаться вместе с телом.
   */
  public getPoleQuaternion(): Quaternion {
    const qNode: Quaternion = new Quaternion().setFromAxisAngle(Z_AXIS, degToRad(this.ascendingNode))
    const qInc: Quaternion = new Quaternion().setFromAxisAngle(X_AXIS, degToRad(this.inclination))

    return ASTRO_TO_THREE.clone().multiply(qNode.multiply(qInc)).multiply(THREE_TO_ASTRO)
  }

  /**
   * Кватернион ориентации тела в координатах Three.js (Y-up).
   *
   * Строится в астро-фрейме как Rz(узел)·Rx(наклон)·Rz(W) и сопрягается
   * конвертацией фреймов: полюс тела (локальный +Y меша) уходит в направление
   * полюса, вращение W крутит меш вокруг собственного полюса.
   */
  public getQuaternion(epoch: number): Quaternion {
    const qNode: Quaternion = new Quaternion().setFromAxisAngle(Z_AXIS, degToRad(this.ascendingNode))
    const qInc: Quaternion = new Quaternion().setFromAxisAngle(X_AXIS, degToRad(this.inclination))
    const qSpin: Quaternion = new Quaternion().setFromAxisAngle(Z_AXIS, degToRad(this.getMeridianAngleByEpoch(epoch)))

    const astro: Quaternion = qNode.multiply(qInc).multiply(qSpin)

    return ASTRO_TO_THREE.clone().multiply(astro).multiply(THREE_TO_ASTRO)
  }
}

export { OrientationModel }
