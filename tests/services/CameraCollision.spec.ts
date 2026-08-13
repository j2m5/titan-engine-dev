import { describe, expect, it } from 'vitest'
import { Object3D, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { COLLISION_GAP, collectColliders } from '@/core/services/CameraCollision'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { makeBody, makeModel, makeCollision } from './cameraCollisionStubs'

const EARTH_RADIUS_KM = 6360
const R = toThreeJSUnits(EARTH_RADIUS_KM) * COLLISION_GAP

describe('collectColliders: состав кэша', () => {
  it('строит сферу по физическому радиусу с зазором', () => {
    const colliders = collectColliders([makeBody('planet', EARTH_RADIUS_KM)])

    expect(colliders).toHaveLength(1)
    expect(colliders[0].radius).toBeCloseTo(toThreeJSUnits(EARTH_RADIUS_KM) * COLLISION_GAP, 10)
  })

  it('исключает чёрную дыру', () => {
    // Решение владельца: ЧД — объект уникальный, коллизии для неё отложены
    expect(collectColliders([makeBody('blackHole', 100000)])).toHaveLength(0)
  })

  it('молча пропускает тело без модели и тело без радиуса', () => {
    const withoutModel = new Object3D()
    withoutModel.userData.type = 'planet'

    const objects = [withoutModel, makeBody('planet', null), makeBody('star', EARTH_RADIUS_KM)]

    expect(collectColliders(objects)).toHaveLength(1)
  })

  it('схлопывает LOD-дубли одного актора в одну сферу', () => {
    // Снапшот ищет по userData.type и находит и меш, и импостор-уровень —
    // оба указывают на одну модель
    const shared = makeModel(EARTH_RADIUS_KM)
    const objects = [
      makeBody('planet', EARTH_RADIUS_KM, new Vector3(), shared),
      makeBody('planet', EARTH_RADIUS_KM, new Vector3(), shared)
    ]

    expect(collectColliders(objects)).toHaveLength(1)
  })
})

describe('CameraCollision: пуш-аут', () => {
  it('старт внутри сферы — камера на поверхности, по нормали наружу', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(R * 0.5, 0, 0))

    collision.resolve()

    expect(camera.position.x).toBeCloseTo(R, 10)
    expect(camera.position.y).toBeCloseTo(0, 10)
    expect(camera.position.z).toBeCloseTo(0, 10)
  })

  it('тело наехало на неподвижную камеру — камеру вытолкнуло', () => {
    // Порядок кадра: тела двигаются по эпохе после движения камеры, при
    // ускоренном времени планета догоняет стоящую камеру
    const body = makeBody('planet', EARTH_RADIUS_KM, new Vector3(R * 10, 0, 0))
    const { collision, camera } = makeCollision([body], new Vector3(R * 3, 0, 0))

    collision.resolve()
    body.position.setX(R * 2.5)
    collision.resolve()

    expect(camera.position.distanceTo(body.position)).toBeCloseTo(R, 10)
  })

  it('камера ровно в центре тела не даёт NaN', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(0, 0, 0))

    collision.resolve()

    expect(camera.position.length()).toBeCloseTo(R, 10)
  })

  it('выталкивание из луны не оставляет камеру внутри планеты', () => {
    // Луна лежит на поверхности планеты, камера в пересечении обеих сфер
    const planet = makeBody('planet', EARTH_RADIUS_KM)
    const moonKm = EARTH_RADIUS_KM / 2
    const moon = makeBody('planet', moonKm, new Vector3(R, 0, 0))
    const { collision, camera } = makeCollision([planet, moon], new Vector3(R * 0.9, 0, 0))

    collision.resolve()

    expect(camera.position.length()).toBeGreaterThanOrEqual(R - 1e-9)
    expect(camera.position.distanceTo(moon.position)).toBeGreaterThanOrEqual(
      toThreeJSUnits(moonKm) * COLLISION_GAP - 1e-9
    )
  })

  it('пустой снапшот — no-op без исключений', () => {
    const { collision, camera } = makeCollision([], new Vector3(1, 2, 3))

    expect(() => collision.resolve()).not.toThrow()
    expect(camera.position.toArray()).toEqual([1, 2, 3])
  })
})

describe('CameraCollision: свип и скольжение', () => {
  it('пролёт насквозь за один кадр пойман на входе (туннелирование)', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(-R * 1000, 0, 0))

    collision.resolve()
    camera.position.set(R * 1000, 0, 0)
    collision.resolve()

    // Лобовое движение: касательной составляющей нет, камера у точки входа
    expect(camera.position.x).toBeCloseTo(-R, 3)
    expect(camera.position.length()).toBeGreaterThanOrEqual(R - 1e-9)
  })

  it('движение под углом скользит по поверхности: нормаль погашена, касательная жива', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(-R * 2, R * 0.5, 0))

    collision.resolve()
    camera.position.set(0, R * 0.5, 0)
    collision.resolve()

    // Не внутри сферы, но и не прилипла к точке контакта: уехала по касательной
    expect(camera.position.length()).toBeGreaterThanOrEqual(R - 1e-9)
    expect(camera.position.y).toBeGreaterThan(R * 0.5)
    expect(camera.position.x).toBeGreaterThan(-R)
  })

  it('серия шагов к центру не пробивает поверхность (инвариант зазора)', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(R * 2, R * 2, R * 2))

    collision.resolve()

    for (let step = 0; step < 5; step++) {
      camera.position.multiplyScalar(0.4)
      collision.resolve()

      expect(camera.position.length()).toBeGreaterThanOrEqual(R - 1e-9)
    }
  })

  it('reset() после телепорта не даёт ложного клампа', () => {
    // Смена сценария: EngineStore ставит defaultCameraPosition, тело осталось
    // между старой и новой позициями
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(-R * 5, 0, 0))

    collision.resolve()
    camera.position.set(R * 5, 0, 0)
    collision.reset()
    collision.resolve()

    expect(camera.position.toArray()).toEqual([R * 5, 0, 0])
  })

  it('телепорт без reset() ловится свипом — контраст к предыдущему тесту', () => {
    const body = makeBody('planet', EARTH_RADIUS_KM)
    const { collision, camera } = makeCollision([body], new Vector3(-R * 5, 0, 0))

    collision.resolve()
    camera.position.set(R * 5, 0, 0)
    collision.resolve()

    expect(camera.position.x).toBeCloseTo(-R, 3)
  })
})
