import { describe, it, expect, vi } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
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

import { ringLightDirection } from '@/core/renderables/DetailedRingStreamingSystem/ringLightDirection'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import type { UpdateContext } from '@/core/UpdateContext'
import { internalsOf, poolOf } from '../helpers/ringSystemInternals'

const makeBeltActor = (): Actor =>
  ({
    getAttribute: () => 1,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1 })
    },
    resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
  }) as unknown as Actor

const makeRingActor = (): Actor =>
  ({
    ...makeBeltActor(),
    parent: { physicalObject: { getAttribute: () => 60000 } }
  }) as unknown as Actor

const beltData: IAsteroidBeltRenderingObject = {
  innerRadiusAu: 40,
  outerRadiusAu: 60,
  thicknessAu: 0.1,
  meanSpacingKm: 60,
  dustEnabled: true
}

const beltNodeActor = (): Actor =>
  ({
    placement: null,
    renderingObject: { getAttribute: (): unknown => beltData },
    getAttribute: (key: string, fallback: unknown = ''): unknown => (key === 'categoryId' ? 11 : fallback)
  }) as unknown as Actor

const frameAt = (target: { updateObject(ctx: UpdateContext): void }, x: number, y: number, z: number): void => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)
  camera.position.set(x, y, z)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  target.updateObject({ delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext)
}

describe('ringLightDirection', () => {
  it('светило вне начала — нормированный вектор к нему, камера не участвует', () => {
    const out = ringLightDirection(new Vector3(0, 0, 8), new Vector3(3, 0, 0), new Vector3())

    expect(out.toArray()).toEqual([0, 0, 1])
  })

  it('светило в начале — направление от камеры к началу', () => {
    const out = ringLightDirection(new Vector3(), new Vector3(3, 4, 0), new Vector3())

    expect(out.x).toBeCloseTo(-0.6, 6)
    expect(out.y).toBeCloseTo(-0.8, 6)
    expect(out.z).toBeCloseTo(0, 6)
  })

  it('светило и камера в начале — ось X, как дефолт юниформа', () => {
    expect(ringLightDirection(new Vector3(), new Vector3(), new Vector3()).toArray()).toEqual([1, 0, 0])
  })

  it('out может совпадать с входом светила', () => {
    const v = new Vector3(0, 5, 0)

    expect(ringLightDirection(v, new Vector3(1, 0, 0), v).toArray()).toEqual([0, 1, 0])
  })
})

describe('AsteroidRingSystem: uDustLightDirRing', () => {
  it('пояс (звезда в начале): направление от камеры во всех трёх материалах', () => {
    const system = new AsteroidRingSystem(makeBeltActor(), { frame: 'system', planetRadiusKm: 0 })
    system.updateMatrixWorld(true)
    frameAt(system, 30, 40, 0)

    const expected = [-0.6, -0.8, 0]
    const pool = poolOf(system)
    const dust = internalsOf(system).dustVolume
    for (const dir of [
      pool.geometryMaterial.uniforms.uDustLightDirRing.value,
      pool.billboardMaterial.uniforms.uDustLightDirRing.value,
      dust!.dustMaterial.uniforms.uDustLightDirRing.value
    ] as Vector3[]) {
      expect(dir.x).toBeCloseTo(expected[0], 6)
      expect(dir.y).toBeCloseTo(expected[1], 6)
      expect(dir.z).toBeCloseTo(expected[2], 6)
    }
  })

  it('кольцо у планеты вне начала мира: прежний вектор к звезде, от камеры не зависит', () => {
    const system = new AsteroidRingSystem(makeRingActor())
    system.position.set(0, 0, 100)
    system.updateMatrixWorld(true)
    frameAt(system, 52, 0, 100)

    // Дефолтный frame поворачивает кольцо на 90° вокруг X: мировой -Z становится ring-local +Y
    const dir = poolOf(system).geometryMaterial.uniforms.uDustLightDirRing.value as Vector3
    expect(dir.x).toBeCloseTo(0, 6)
    expect(Math.abs(dir.y)).toBeCloseTo(1, 6)
    expect(dir.z).toBeCloseTo(0, 6)
  })
})

describe('AsteroidBelt: дальний слой пыли получает направление от камеры', () => {
  it('камера на 50 а.е. по X — свет вдоль -X', () => {
    const belt = new AsteroidBelt(beltNodeActor())
    belt.updateMatrixWorld(true)
    frameAt(belt, fromAstronomicalUnits(50), 0, 0)

    const dust = (belt as unknown as { dustVolume: { dustMaterial: { uniforms: { uDustLightDirRing: { value: Vector3 } } } } }).dustVolume
    const dir = dust.dustMaterial.uniforms.uDustLightDirRing.value
    expect(dir.x).toBeCloseTo(-1, 6)
    expect(dir.y).toBeCloseTo(0, 6)
    expect(dir.z).toBeCloseTo(0, 6)
  })
})
