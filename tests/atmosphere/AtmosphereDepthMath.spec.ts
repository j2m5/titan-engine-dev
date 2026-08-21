import { Vector3 } from 'three'
import { SpaceScale } from '@/core/constants'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { clipRayToShell, logDepthToDistanceKm, orderSlots } from '@/core/graphic/effects/atmosphere/atmosphereDepthMath'

/** Зеркало logdepthbuf_fragment three: z = log2(1 + w) / log2(far + 1). */
function encodeLogDepth(w: number, far: number): number {
  return Math.log2(1 + w) / Math.log2(far + 1)
}

const FAR = fromAstronomicalUnits(2000)

describe('logDepthToDistanceKm', () => {
  it('восстанавливает расстояние вдоль оси камеры из лог-глубины three', () => {
    const wUnits = 6400 * SpaceScale // 6400 км в юнитах
    const z = encodeLogDepth(wUnits, FAR)
    expect(logDepthToDistanceKm(z, -1, FAR, SpaceScale)).toBeCloseTo(6400, 6)
  })

  it('делит на косинус к оси: луч под 60° к оси в 2 раза длиннее', () => {
    const z = encodeLogDepth(100 * SpaceScale, FAR)
    expect(logDepthToDistanceKm(z, -0.5, FAR, SpaceScale)).toBeCloseTo(200, 6)
  })

  it('z = 1 (очищенный буфер, небо) → бесконечность', () => {
    expect(logDepthToDistanceKm(1, -1, FAR, SpaceScale)).toBe(Infinity)
    expect(logDepthToDistanceKm(1 - 1e-7, -1, FAR, SpaceScale)).toBe(Infinity)
  })
})

describe('clipRayToShell: камера в нуле, всё в км', () => {
  const top = 6420
  const dir = new Vector3(0, 0, -1)

  it('луч мимо оболочки → null', () => {
    const center = new Vector3(20000, 0, -50000)
    expect(clipRayToShell(dir, center, top, Infinity)).toBeNull()
  })

  it('снаружи, луч в небо сквозь оболочку: t0 — вход, t1 — выход, поверхности нет', () => {
    const center = new Vector3(0, 6000, -50000) // хорда на высоте 6000 над центром
    const seg = clipRayToShell(dir, center, top, Infinity)!
    const half = Math.sqrt(top * top - 6000 * 6000)
    expect(seg.t0).toBeCloseTo(50000 - half, 6)
    expect(seg.t1).toBeCloseTo(50000 + half, 6)
    expect(seg.hitSurface).toBe(false)
  })

  it('снаружи, луч в землю: t1 обрезан глубиной, hitSurface', () => {
    const center = new Vector3(0, 0, -50000)
    const distKm = 50000 - 6360 // поверхность на датуме
    const seg = clipRayToShell(dir, center, top, distKm)!
    expect(seg.t0).toBeCloseTo(50000 - top, 6)
    expect(seg.t1).toBeCloseTo(distKm, 6)
    expect(seg.hitSurface).toBe(true)
  })

  it('поверхность ПЕРЕД оболочкой (луна перед планетой) → null', () => {
    const center = new Vector3(0, 0, -50000)
    expect(clipRayToShell(dir, center, top, 1000)).toBeNull()
  })

  it('камера внутри оболочки: t0 = 0', () => {
    const center = new Vector3(0, -6380, 0) // камера в 20 км над датумом
    const seg = clipRayToShell(dir, center, top, Infinity)!
    expect(seg.t0).toBe(0)
    expect(seg.t1).toBeGreaterThan(0)
    expect(seg.hitSurface).toBe(false)
  })

  it('камера внутри, взгляд в грунт: t1 = глубина, hitSurface', () => {
    const center = new Vector3(0, -6380, 0)
    const down = new Vector3(0, -1, 0)
    const seg = clipRayToShell(down, center, top, 20)!
    expect(seg.t0).toBe(0)
    expect(seg.t1).toBe(20)
    expect(seg.hitSurface).toBe(true)
  })
})

describe('orderSlots: от дальней к ближней, потолок K, отсев невидимых', () => {
  const mk = (name: string, z: number, top: number) => ({ entry: name, centerKm: new Vector3(0, 0, -z), topRadiusKm: top })

  it('сортирует по убыванию расстояния до центра', () => {
    const { chosen } = orderSlots([mk('near', 10000, 100), mk('far', 90000, 5000), mk('mid', 50000, 1000)], 3, 0)
    expect(chosen.map((c) => c.entry)).toEqual(['far', 'mid', 'near'])
  })

  it('лишние сверх K уходят в dropped — самые дальние и мелкие', () => {
    const { chosen, dropped } = orderSlots([mk('a', 1000, 100), mk('b', 2000, 100), mk('c', 3000, 100), mk('d', 4000, 100)], 3, 0)
    expect(chosen).toHaveLength(3)
    expect(dropped).toEqual(['d'])
  })

  it('отсев по угловому размеру top/dist ниже порога', () => {
    const { chosen, dropped } = orderSlots([mk('tiny', 1e6, 1), mk('big', 1e5, 5000)], 3, 1e-4)
    expect(chosen.map((c) => c.entry)).toEqual(['big'])
    expect(dropped).toEqual(['tiny'])
  })

  it('камера внутри оболочки — угловой размер бесконечный, запись не отсеивается', () => {
    const { chosen } = orderSlots([mk('inside', 100, 6420)], 3, 1e-4)
    expect(chosen).toHaveLength(1)
    expect(chosen[0].angular).toBe(Infinity)
  })
})
