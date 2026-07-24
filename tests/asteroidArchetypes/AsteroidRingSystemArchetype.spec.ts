import { vi } from 'vitest'

const fakeTexture = { name: 'any' }
vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => undefined, getTextureOrMake: () => fakeTexture }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import { IcosahedronGeometry } from 'three'

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
    const pos = (system as any).pool.geometryMesh.geometry.getAttribute('position')
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
    const pa = (a as any).pool.geometryMesh.geometry.getAttribute('position').array as Float32Array
    const pb = (b as any).pool.geometryMesh.geometry.getAttribute('position').array as Float32Array
    expect(Array.from(pa.slice(0, 300))).toEqual(Array.from(pb.slice(0, 300)))
  })

  it('остаточные амплитуды по умолчанию: 0.03–0.06', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = (system as any).pool.geometryMesh.material.uniforms
    expect(u.uShapeAmpMin.value).toBeCloseTo(0.03, 10)
    expect(u.uShapeAmpMax.value).toBeCloseTo(0.06, 10)
  })
})
