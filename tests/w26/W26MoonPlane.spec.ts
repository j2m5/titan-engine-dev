import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Actors } from '@storage/database'
import { Actor } from '@/core/models/Actor'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { OrientationModel } from '@/core/libs/OrientationModel'

const byName = (name: string): Actor => {
  const row = Actors.find((a) => a.name === name)

  expect(row, `актор «${name}» не найден`).toBeDefined()

  return Actor.find(row!.id)!
}

/** Полюс тела в координатах Three.js: локальный +Y экваториальной рамки. */
const poleOf = (model: Actor): Vector3 =>
  new Vector3(0, 1, 0).applyQuaternion(new OrientationModel(model).getPoleQuaternion())

/** Угол между двумя направлениями, градусы. */
const angleDeg = (u: Vector3, v: Vector3): number =>
  (Math.acos(Math.max(-1, Math.min(1, u.clone().normalize().dot(v.clone().normalize())))) * 180) / Math.PI

/** Наклон плоскости орбиты спутника к экватору планеты-хозяина, градусы. */
const tiltToEquatorDeg = (moon: string, host: string): number =>
  angleDeg(poleOf(byName(host)), new KeplerianModel(byName(moon)).getNormalVector())

// Обе модели строят нормаль в астро-фрейме как Rz(узел)·Rx(наклон)·ẑ и
// переводят одним и тем же ASTRO_TO_THREE — углы ниже сравнимы напрямую.
describe('плоскость орбит спутников относительно экватора планеты', () => {
  it('прецедент Adriana (axialTilt −29.6°): спутники следуют наклону хозяина', () => {
    for (const moon of ['Adriana I', 'Adriana II', 'Adriana III', 'Adriana IV']) {
      // Собственные расхождения по наклону (до 6.2°) и узлу (до 15.1°) дают
      // разброс до ~11°; ошибка фрейма дала бы десятки градусов.
      expect(tiltToEquatorDeg(moon, 'Adriana'), moon).toBeLessThan(11)
    }
  })

  it('спутники Halcyra лежат в плоскости кольца (экватор, axialTilt 23°)', () => {
    for (const moon of ['Halcyra I', 'Halcyra II']) {
      expect(tiltToEquatorDeg(moon, 'Halcyra'), moon).toBeLessThan(2)
    }

    // Небольшая разница между спутниками сохранена
    expect(tiltToEquatorDeg('Halcyra II', 'Halcyra')).toBeGreaterThan(tiltToEquatorDeg('Halcyra I', 'Halcyra'))
  })
})
