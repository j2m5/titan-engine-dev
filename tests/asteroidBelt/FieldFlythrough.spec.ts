import { describe, it, expect, vi } from 'vitest'
import { Vector3 } from 'three'
import '@/core/framework/TitanThree'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => ({ name: 'ring.png' }),
    getTextureOrMake: () => ({ name: 'ring.png' })
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { fromAstronomicalUnits, toThreeJSUnits } from '@/core/helpers/scaling'
import { Actors, RenderingObjects } from '@storage/database'
import { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import { measureBeltField, measureBeltFieldFlythrough } from '../helpers/beltField'

/** Строка «Ashfall Belt» — реальный пояс системы W26 из поставляемой базы, не синтетика (см. FieldDensity.spec.ts) */
function beltActorFromDatabase(): Actor {
  const actorRow = Actors.find((a) => a.name === 'Ashfall Belt')
  if (!actorRow) throw new Error('в поставляемой базе нет актора Ashfall Belt')
  const renderingRow = RenderingObjects.find((r) => r.actorId === actorRow.id)
  if (!renderingRow) throw new Error('у Ashfall Belt нет строки renderingObject в поставляемой базе')
  const data = renderingRow.data as unknown as IAsteroidBeltRenderingObject

  return {
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (key: string, fallback: unknown = ''): unknown => {
      if (key === 'categoryId') return actorRow.categoryId
      if (key === 'name') return actorRow.name
      if (key === 'id') return actorRow.id
      return fallback
    }
  } as unknown as Actor
}

describe('Поле пояса на движении: пролёт сквозь плотное поле', () => {
  it('живые инстансы не проседают ниже ~70% осевшего значения, отказов нет, поле восстанавливается после пролёта', () => {
    // Путь — поперёк локального радиуса-вектора (тангенциально), на постоянном
    // радиусе 50 а.е.: 200 000 км — ничтожная доля ширины пояса (16 а.е. ≈
    // 2.4 млрд км), поэтому радиальные щели/сгущения структуры пояса (см.
    // buildBeltDensityProfile) в этот локальный отрезок не попадают — просадка
    // ниже проверяется как честная реакция стримера на движение камеры, а не
    // как пересечение осознанно разреженного участка данных.
    //
    // Шаг 3333.3 км/кадр; при 60 кадрах/с это 200 000 км/с ≈ 0.667c —
    // умышленно быстрый (сай-фай) пролёт: 200 000 км — это ~6 радиусов
    // заселения самого крупного каскада (~33 435 км), достаточно, чтобы
    // пересечь несколько поколений секторов за 60 кадров.
    const radiusAu = 50
    const totalKm = 200_000
    const frames = 60
    const stepKm = totalKm / frames

    const belt = new AsteroidBelt(beltActorFromDatabase())
    const start = new Vector3(fromAstronomicalUnits(radiusAu), 0, toThreeJSUnits(-totalKm / 2))
    const step = new Vector3(0, 0, toThreeJSUnits(stepKm))

    // Осевшее значение В ТОЧКЕ СТАРТА (а не где-то ещё): камера начинает
    // движение уже находясь в устаканившемся поле, как в реальном полёте —
    // не выныривая из пустоты в момент t=0.
    const settled = measureBeltField(belt, start)
    expect(settled.total).toBeGreaterThan(10000)

    const flight = measureBeltFieldFlythrough(belt, start, step, frames)
    // Плавающее начало реально переезжает на этой дистанции — иначе замер
    // движения ничем не отличался бы от статичного (см. FloatingOrigin)
    expect(flight.rebaseCount).toBeGreaterThan(0)

    const threshold = settled.total * 0.7
    for (const sample of flight.samples) {
      expect(sample.liveInstances).toBeGreaterThanOrEqual(threshold)
      expect(sample.poolFailures).toBe(0)
      expect(sample.capacityFailures).toBe(0)
    }

    // «Поле восстанавливается после пролёта»: камера останавливается в конце
    // пути и держится там ещё 20 кадров — популяция обязана вернуться к
    // норме, а не застрять на просевшем от движения значении.
    const endPoint = start.clone().add(step.clone().multiplyScalar(frames))
    const refill = measureBeltFieldFlythrough(belt, endPoint, new Vector3(0, 0, 0), 20)
    const last = refill.samples[refill.samples.length - 1]
    expect(last.liveInstances).toBeGreaterThanOrEqual(settled.total * 0.9)
    for (const sample of refill.samples) {
      expect(sample.poolFailures).toBe(0)
      expect(sample.capacityFailures).toBe(0)
    }
  })
})
