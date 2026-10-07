import { describe, it, expect } from 'vitest'
import { BufferGeometry, SphereGeometry, Vector3 } from 'three'
import { buildSphereGeometry, circumscribeFactor, warmSphereTemplate } from '@/core/renderables/utils/sphereGeometry'

const RADIUS: number = 7.3

function attributeArray(geometry: BufferGeometry, name: string): Float32Array {
  return geometry.getAttribute(name).array as Float32Array
}

function maxAbsDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0

  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]))

  return max
}

/** Наименьшее расстояние от центра до плоскости грани: ближе него силуэт многогранника не подходит */
function minFacePlaneDistance(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position')
  const index = geometry.index!.array
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  const ab = new Vector3()
  const ac = new Vector3()
  let min = Infinity

  for (let i = 0; i < index.length; i += 3) {
    a.fromBufferAttribute(position, index[i])
    b.fromBufferAttribute(position, index[i + 1])
    c.fromBufferAttribute(position, index[i + 2])
    ab.subVectors(b, a).cross(ac.subVectors(c, a))

    if (ab.lengthSq() === 0) continue

    min = Math.min(min, Math.abs(ab.normalize().dot(a)))
  }

  return min
}

describe('buildSphereGeometry — копия единичной заготовки', () => {
  it.each([64, 128, 256])('N = %i: совпадает с new SphereGeometry(r, N, N)', (segments: number) => {
    const built = buildSphereGeometry(RADIUS, segments)
    const reference = new SphereGeometry(RADIUS, segments, segments)

    expect(built.getAttribute('position').count).toBe((segments + 1) ** 2)
    // Заготовка × r против r внутри тригонометрии — расхождение только в округлении float32
    expect(maxAbsDifference(attributeArray(built, 'position'), attributeArray(reference, 'position'))).toBeLessThan(
      1e-6 * RADIUS
    )
    // normalize(r·a) против a — то же округление
    expect(maxAbsDifference(attributeArray(built, 'normal'), attributeArray(reference, 'normal'))).toBeLessThan(1e-6)
    // uv и индекс от радиуса не зависят — равны точно; тип индекса тот же (Uint16 до 65 535 вершин)
    // Точное равенство циклом, а не toEqual: глубокое сравнение сотен тысяч
    // элементов на N = 256 шло секунды и под нагрузкой прогона выбивало таймаут
    expect(attributeArray(built, 'uv').length).toBe(attributeArray(reference, 'uv').length)
    expect(maxAbsDifference(attributeArray(built, 'uv'), attributeArray(reference, 'uv'))).toBe(0)
    expect(built.index!.array.length).toBe(reference.index!.array.length)
    expect(maxAbsDifference(built.index!.array, reference.index!.array)).toBe(0)
    expect(built.index!.array.constructor).toBe(reference.index!.array.constructor)
  })

  it('ограничивающая сфера выставлена сразу: центр 0, радиус r', () => {
    const built = buildSphereGeometry(RADIUS, 64)

    expect(built.boundingSphere).not.toBeNull()
    expect(built.boundingSphere!.center.equals(new Vector3())).toBe(true)
    expect(built.boundingSphere!.radius).toBe(RADIUS)
  })

  it('две постройки не делят ни атрибутов, ни массивов: dispose одной снёс бы GPU-буферы другой', () => {
    const first = buildSphereGeometry(1, 64)
    const second = buildSphereGeometry(2, 64)

    for (const name of ['position', 'normal', 'uv']) {
      expect(first.getAttribute(name)).not.toBe(second.getAttribute(name))
      expect(first.getAttribute(name).array.buffer).not.toBe(second.getAttribute(name).array.buffer)
    }

    expect(first.index).not.toBe(second.index)
    expect(first.index!.array.buffer).not.toBe(second.index!.array.buffer)
  })

  it('запись в копию не портит заготовку', () => {
    const first = buildSphereGeometry(1, 64)

    attributeArray(first, 'normal').fill(0)
    ;(first.index!.array as Uint16Array).fill(0)

    const second = buildSphereGeometry(1, 64)
    const reference = new SphereGeometry(1, 64, 64)

    expect(maxAbsDifference(attributeArray(second, 'normal'), attributeArray(reference, 'normal'))).toBeLessThan(1e-6)
    expect(maxAbsDifference(second.index!.array, reference.index!.array)).toBe(0)
  })

  it('прогрев идемпотентен и не меняет результат постройки', () => {
    warmSphereTemplate(64)
    warmSphereTemplate(64)

    const built = buildSphereGeometry(RADIUS, 64)
    const reference = new SphereGeometry(RADIUS, 64, 64)

    expect(maxAbsDifference(attributeArray(built, 'position'), attributeArray(reference, 'position'))).toBeLessThan(
      1e-6 * RADIUS
    )
  })
})

describe('circumscribeFactor', () => {
  it('на 256 бит в бит равен прежнему выражению Planet', () => {
    expect(circumscribeFactor(256)).toBe(1 / (Math.cos(Math.PI / 256) * Math.cos(Math.PI / 512)))
  })

  it.each([64, 256])('N = %i: описанный многогранник не проваливается внутрь истинной сферы', (segments: number) => {
    const circumscribed = buildSphereGeometry(RADIUS * circumscribeFactor(segments), segments)

    expect(minFacePlaneDistance(circumscribed)).toBeGreaterThanOrEqual(RADIUS * (1 - 1e-6))
  })

  it('без множителя грани 64 проваливаются — тест выше различает', () => {
    expect(minFacePlaneDistance(buildSphereGeometry(RADIUS, 64))).toBeLessThan(RADIUS * (1 - 1e-3))
  })
})
