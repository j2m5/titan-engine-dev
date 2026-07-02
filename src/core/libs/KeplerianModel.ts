import { TKeplerianModel } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { CIRCLE, G, J2000, SolarMass } from '@/core/constants'
import { Quaternion, Vector3 } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { ASTRO_TO_THREE } from '@/core/libs/frames'

export type OrbitalState = {
  position: Vector3
  velocity: Vector3
}

class KeplerianModel implements TKeplerianModel {
  private readonly model: Actor

  public constructor(model: Actor) {
    this.model = model
  }

  /**
   * Эпоха оскулирующих элементов (юлианская дата, сутки) —
   * момент, на который снята meanAnomalyAtEpoch. Свойство данных орбиты,
   * а не момента создания модели.
   */
  public get epoch(): number {
    return this.model.orbit?.getAttribute('epoch', J2000)
  }

  public get semiMajorAxis(): number {
    return this.model.orbit?.getAttribute('semiMajorAxis', 0)
  }

  public get eccentricity(): number {
    return this.model.orbit?.getAttribute('eccentricity', 0)
  }

  public get inclination(): number {
    return this.model.orbit?.getAttribute('inclination', 0)
  }

  public get __inclination(): number {
    return degToRad(this.inclination)
  }

  public get argOfPeriapsis(): number {
    return this.model.orbit?.getAttribute('argOfPeriapsis', 0)
  }

  public get __argOfPeriapsis(): number {
    return degToRad(this.argOfPeriapsis)
  }

  public get ascendingNode(): number {
    return this.model.orbit?.getAttribute('ascendingNode', 0)
  }

  public get __ascendingNode(): number {
    return degToRad(this.ascendingNode)
  }

  public get meanAnomalyAtEpoch(): number {
    return this.model.orbit?.getAttribute('meanAnomalyAtEpoch', 0)
  }

  public get __meanAnomalyAtEpoch(): number {
    return degToRad(this.meanAnomalyAtEpoch)
  }

  /**
   * Гравитационный параметр системы, AU³/сутки².
   * G — гауссова GM Солнца (k²), поэтому массы нормируются на массу Солнца.
   */
  public get mu(): number {
    if (this.model.parent && this.model.parent.physicalObject && this.model.physicalObject) {
      return (
        (G *
          (this.model.parent.physicalObject.getAttribute('mass') +
            this.model.physicalObject.getAttribute('mass'))) /
        SolarMass
      )
    }

    return 0
  }

  /**
   * Явный сидерический период из данных орбиты, сутки; 0 = не задан.
   * Нужен для барицентрических подорбит (Луна/Земля вокруг EMB, бинарные
   * звёзды): там сумма масс родителя и тела не даёт корректного n.
   */
  private get dataPeriod(): number {
    return this.model.orbit?.getAttribute('period', 0)
  }

  /** Среднее движение, рад/сутки (эпоха — юлианская дата в сутках) */
  public get meanMotion(): number {
    if (this.dataPeriod > 0) {
      return CIRCLE / this.dataPeriod
    }

    const a: number = Math.abs(this.semiMajorAxis)

    return Math.sqrt(this.mu / (a * a * a))
  }

  public get isHyperbolic(): boolean {
    return this.eccentricity > 1
  }

  public get isElliptic(): boolean {
    return this.eccentricity < 1
  }

  /** Орбитальный период, сутки */
  public get period(): number {
    if (!this.isElliptic) return 0

    return CIRCLE / this.meanMotion
  }

  public getNodalPrecessionRate(r: number, j2: number): number {
    return (
      ((-3 / 2) * r * r * j2 * Math.cos(this.__inclination) * this.meanMotion) /
      Math.pow(this.semiMajorAxis * (1 - this.eccentricity * this.eccentricity), 2)
    )
  }

  public getNodalPrecessionByEpoch(r: number, j2: number, epoch: number): number {
    return (epoch - this.epoch) * this.getNodalPrecessionRate(r, j2)
  }

  public getMeanAnomalyByEpoch(epoch: number): number {
    return this.__meanAnomalyAtEpoch + this.meanMotion * (epoch - this.epoch)
  }

  public getEccentricAnomalyByEpoch(epoch: number): number {
    return this.getEccentricAnomalyByMeanAnomaly(this.getMeanAnomalyByEpoch(epoch))
  }

  public getTrueAnomalyByEpoch(epoch: number): number {
    return this.getTrueAnomalyByMeanAnomaly(this.getMeanAnomalyByEpoch(epoch))
  }

  public getMeanAnomalyByEccentricAnomaly(ea: number): number {
    if (this.isElliptic) {
      return ea - this.eccentricity * Math.sin(ea)
    } else {
      return this.eccentricity * Math.sinh(ea) - ea
    }
  }

  public getMeanAnomalyByTrueAnomaly(ta: number): number {
    return this.getMeanAnomalyByEccentricAnomaly(this.getEccentricAnomalyByTrueAnomaly(ta))
  }

  public getEccentricAnomalyByMeanAnomaly(ma: number): number {
    const maxIter: number = 30
    const delta: number = 0.00000001
    let M: number = ma
    let E,
      F,
      i: number = 0

    if (this.isElliptic) {
      M = M / (2.0 * Math.PI)
      M = 2.0 * Math.PI * (M - Math.floor(M))

      E = this.eccentricity < 0.8 ? M : Math.PI

      F = E - this.eccentricity * Math.sin(E) - M

      while (Math.abs(F) > delta && i < maxIter) {
        E = E - F / (1.0 - this.eccentricity * Math.cos(E))
        F = E - this.eccentricity * Math.sin(E) - M
        i = i + 1
      }
    } else {
      E =
        (Math.log(2 * (Math.abs(M) + 1 / 3)) + 1) / this.eccentricity +
        (1 - 1 / this.eccentricity) * Math.asinh(Math.abs(M) / this.eccentricity)
      E *= Math.sign(M)

      F = this.eccentricity * Math.sinh(E) - E - M

      while (Math.abs(F) > delta && i < maxIter) {
        E = E - F / (this.eccentricity * Math.cosh(E) - 1)
        F = this.eccentricity * Math.sinh(E) - E - M
        i = i + 1
      }
    }

    return E
  }

  public getEccentricAnomalyByTrueAnomaly(ta: number): number {
    if (this.isElliptic) {
      const cos: number = Math.cos(ta)
      const cosE: number = (this.eccentricity + cos) / (1 + this.eccentricity * cos)
      return (ta + CIRCLE) % CIRCLE <= Math.PI ? Math.acos(cosE) : CIRCLE - Math.acos(cosE)
    } else {
      return 2 * Math.atanh(Math.tan(ta / 2) / Math.sqrt((this.eccentricity + 1) / (this.eccentricity - 1)))
    }
  }

  public getTrueAnomalyByMeanAnomaly(ma: number): number {
    return this.getTrueAnomalyByEccentricAnomaly(this.getEccentricAnomalyByMeanAnomaly(ma))
  }

  public getTrueAnomalyByEccentricAnomaly(ea: number): number {
    if (this.isElliptic) {
      const phi: number = Math.atan2(
        Math.sqrt(1.0 - this.eccentricity * this.eccentricity) * Math.sin(ea),
        Math.cos(ea) - this.eccentricity
      )
      return phi >= 0 ? phi : phi + 2 * Math.PI
    } else {
      return 2 * Math.atan(Math.sqrt((this.eccentricity + 1) / (this.eccentricity - 1)) * Math.tanh(ea / 2))
    }
  }

  /**
   * Координаты в орбитальной плоскости по истинной аномалии.
   * Возвращает вектор в координатах орбитальной плоскости (x = направление перицентра).
   * Для получения Three.js координат примените getOrbitalFrameQuaternion().
   */
  public getOwnCoordsByTrueAnomaly(ta: number): Vector3 {
    const r: number =
      (this.semiMajorAxis * (1.0 - this.eccentricity * this.eccentricity)) / (1 + this.eccentricity * Math.cos(ta))
    return new Vector3(r * Math.cos(ta), r * Math.sin(ta), 0)
  }

  public getAsymptoteTa(): number {
    if (this.isElliptic) {
      return 0
    }
    return Math.acos(-1 / this.eccentricity)
  }

  public getPeriapsisRadius(): number {
    return this.semiMajorAxis * (1 - this.eccentricity)
  }

  public getApoapsisRadius(): number {
    return this.semiMajorAxis * (1 + this.eccentricity)
  }

  public getPeriapsisSpeed(): number {
    return Math.sqrt(this.mu * (2 / this.getPeriapsisRadius() - 1 / this.semiMajorAxis))
  }

  public getApoapsisSpeed(): number {
    return Math.sqrt(this.mu * (2 / this.getApoapsisRadius() - 1 / this.semiMajorAxis))
  }

  public getEpochByTrueAnomaly(ta: number): number {
    if (ta === null) {
      return 0
    }
    let diff: number = this.getMeanAnomalyByTrueAnomaly(ta) - this.__meanAnomalyAtEpoch
    if (diff < 0 && this.isElliptic) {
      diff += CIRCLE
    }
    return this.epoch + diff / this.meanMotion
  }

  /**
   * Состояние (позиция, скорость) на заданную эпоху.
   * Возвращает векторы в системе координат Three.js (Y-up).
   */
  public getStateByEpoch(epoch: number): OrbitalState {
    if (!this.semiMajorAxis) {
      return {
        position: new Vector3(),
        velocity: new Vector3()
      }
    }

    if (this.isElliptic) {
      const ea: number = this.getEccentricAnomalyByEpoch(epoch)
      const cos: number = Math.cos(ea)
      const sin: number = Math.sin(ea)
      const kff: number = Math.sqrt(this.mu / this.semiMajorAxis) / (1 - this.eccentricity * cos)

      const pos: Vector3 = new Vector3(
        this.semiMajorAxis * (cos - this.eccentricity),
        this.semiMajorAxis * Math.sqrt(1 - this.eccentricity * this.eccentricity) * sin,
        0
      )

      const vel: Vector3 = new Vector3(-kff * sin, kff * Math.sqrt(1 - this.eccentricity * this.eccentricity) * cos, 0)

      return {
        position: pos.applyQuaternion(this.getOrbitalFrameQuaternion()),
        velocity: vel.applyQuaternion(this.getOrbitalFrameQuaternion())
      }
    } else {
      const ta: number = this.getTrueAnomalyByEpoch(epoch)
      const orbitalQuat: Quaternion = this.getOrbitalFrameQuaternion()
      const pos: Vector3 = this.getOwnCoordsByTrueAnomaly(ta)
      const flightPathAngle: number = Math.atan(
        (this.eccentricity * Math.sin(ta)) / (1 + this.eccentricity * Math.cos(ta))
      )
      const vel: Vector3 = new Vector3(Math.sqrt(this.mu * (2 / pos.length() - 1 / this.semiMajorAxis)), 0, 0)

      vel.applyAxisAngle(new Vector3(0, 0, 1), ta + Math.PI / 2 - flightPathAngle)

      return {
        position: pos.applyQuaternion(orbitalQuat),
        velocity: vel.applyQuaternion(orbitalQuat)
      }
    }
  }

  /**
   * Кватернион орбитальной рамки, включающий конвертацию в Three.js (Y-up).
   *
   * Применение этого кватерниона к вектору в орбитальной плоскости
   * сразу даёт координаты в системе Three.js.
   */
  public getOrbitalFrameQuaternion(): Quaternion {
    const quaternion: Quaternion = new Quaternion()

    const xAxis: Vector3 = new Vector3(1, 0, 0)
    const zAxis: Vector3 = new Vector3(0, 0, 1)

    const qRaan: Quaternion = new Quaternion().setFromAxisAngle(zAxis, this.__ascendingNode)
    const qInc: Quaternion = new Quaternion().setFromAxisAngle(xAxis, this.__inclination)
    const qAop: Quaternion = new Quaternion().setFromAxisAngle(zAxis, this.__argOfPeriapsis)

    // Орбитальная рамка в астрономических координатах
    quaternion.copy(qRaan).multiply(qInc).multiply(qAop)

    // Конвертация: astronomical Z-up → Three.js Y-up
    // q_three = q_convert * q_astro
    return ASTRO_TO_THREE.clone().multiply(quaternion)
  }

  /**
   * Нормаль к орбитальной плоскости в координатах Three.js (Y-up).
   */
  public getNormalVector(): Vector3 {
    const nodeQuaternion: Quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), this.__ascendingNode)
    const nodeVector: Vector3 = new Vector3(1, 0, 0).applyQuaternion(nodeQuaternion)
    const incQuaternion: Quaternion = new Quaternion().setFromAxisAngle(nodeVector, this.__inclination)

    return new Vector3(0, 0, 1)
      .applyQuaternion(nodeQuaternion)
      .applyQuaternion(incQuaternion)
      .normalize()
      .applyQuaternion(ASTRO_TO_THREE)
  }
}

export { KeplerianModel }
