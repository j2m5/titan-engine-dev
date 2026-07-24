import { vi } from 'vitest'

const fakeTexture = { name: 'any' }
vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => undefined, getTextureOrMake: () => fakeTexture }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import { IcosahedronGeometry } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 }) },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  }) as unknown as Actor

/* eslint-disable @typescript-eslint/no-explicit-any -- приватные поля в тестах, как в соседних спеках */

describe('AsteroidRingSystem: запечённый архетип в L0', () => {
  it('L0-геометрия — запечённый осколок: тесселяция detail 3, радиусы вершин НЕ равны константе', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const pos = (system as any).pool.geometryMeshes[0].geometry.getAttribute('position')
    expect(pos.count).toBe(new IcosahedronGeometry(1, 3).getAttribute('position').count)
    // Икосаэдр имел бы все |v| = asteroidSize; у осколка радиусы разные
    const radii = new Set<number>()
    for (let i = 0; i < 30; i++) {
      radii.add(Number(Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)).toFixed(6)))
    }
    expect(radii.size).toBeGreaterThan(3)
  })

  it('детерминизм: две системы одного профиля делят форму (побитово равные позиции)', () => {
    const a = new AsteroidRingSystem(makeFakeActor())
    const b = new AsteroidRingSystem(makeFakeActor())
    const pa = (a as any).pool.geometryMeshes[0].geometry.getAttribute('position').array as Float32Array
    const pb = (b as any).pool.geometryMeshes[0].geometry.getAttribute('position').array as Float32Array
    expect(Array.from(pa.slice(0, 300))).toEqual(Array.from(pb.slice(0, 300)))
  })

  it('остаточные амплитуды по умолчанию: 0.03–0.06', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = (system as any).pool.geometryMaterial.uniforms
    expect(u.uShapeAmpMin.value).toBeCloseTo(0.03, 10)
    expect(u.uShapeAmpMax.value).toBeCloseTo(0.06, 10)
  })

  it('LOD-пороги Near-тира из конфига доходят в SectorManager', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    // Приватный доступ к менеджеру и его thresholds (паттерн соседних спек)
    const manager = (system as any).manager
    const thresholds = (manager as any).thresholds

    // Дефолты: l0Near=2500, l0NearExit=3200 км
    // Пороги конвертируются в TU при setup
    const expectedNearEnter = toThreeJSUnits(2500)
    const expectedNearExit = toThreeJSUnits(3200)

    expect(thresholds.nearEnterDistance).toBeCloseTo(expectedNearEnter, 5)
    expect(thresholds.nearExitDistance).toBeCloseTo(expectedNearExit, 5)
  })

  it('конфиг-override для LOD-порогов Near-тира: l0Near=100, l0NearExit=200', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), {
      lodThresholdsKm: {
        l0: 3000,
        l1: 12000,
        l0Near: 100,
        l0NearExit: 200
      }
    })

    const manager = (system as any).manager
    const thresholds = (manager as any).thresholds

    expect(thresholds.nearEnterDistance).toBeCloseTo(toThreeJSUnits(100), 5)
    expect(thresholds.nearExitDistance).toBeCloseTo(toThreeJSUnits(200), 5)
  })

  it('инвариант дефолтных порогов: тир Geometry достижим (l0 > l0NearExit + полудиагональ ячейки)', () => {
    // Метрики порогов РАЗНЫЕ: Near — до ближайшей точки сектора, l0 — до центра.
    // Если l0 ≤ l0NearExit + полудиагональ (~cellSize·0.71), окно Near полностью
    // накрывает окно Geometry → сектора ходят Billboard↔Near, Geometry-стримы
    // вечно пусты (находка финального ревью 2c). Дефолты обязаны держать зазор.
    const system = new AsteroidRingSystem(makeFakeActor())
    const cfg = (system as any).config
    const halfDiagonalKm = cfg.cellSizeKm * Math.SQRT2 * 0.5
    expect(cfg.lodThresholdsKm.l0).toBeGreaterThan(cfg.lodThresholdsKm.l0NearExit + halfDiagonalKm)
  })
})
