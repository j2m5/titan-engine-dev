import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { BufferAttribute, BufferGeometry, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three'
import { createMoonletMesh, moonletMatrix } from '@/core/renderables/DetailedRingStreamingSystem/moonletMesh'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import type { ShapeModelStorage } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelStorage'
import type { ShapeModelData } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'
import type { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const moonlet = { radiusKm: 106620, azimuthDeg: 40, sizeKm: 30, gapKm: 360, model: 'pandora' }
const ASTEROID_SIZE = toThreeJSUnits(10)

function source(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array(9), 3))
  g.setAttribute('surfaceData', new BufferAttribute(new Float32Array(12), 4))
  g.setIndex([0, 1, 2])
  return g
}

describe('лунка: матрица и меш', () => {
  it('позиция (r cos θ, 0, r sin θ) в кольцевых координатах, масштаб — радиус лунки / радиус геометрии', () => {
    const position = new Vector3()
    const scale = new Vector3()
    moonletMatrix(moonlet, ASTEROID_SIZE).decompose(position, new Quaternion(), scale)
    const theta = (40 * Math.PI) / 180
    expect(position.x).toBeCloseTo(toThreeJSUnits(106620) * Math.cos(theta), 9)
    expect(position.y).toBe(0)
    expect(position.z).toBeCloseTo(toThreeJSUnits(106620) * Math.sin(theta), 9)
    expect(scale.x).toBeCloseTo(toThreeJSUnits(15) / ASTEROID_SIZE, 9)
    expect(scale.y).toBeCloseTo(scale.x, 12)
  })

  it('один инстанс на переданном материале; instanceFade = 1, instanceOrigin = 0; атрибуты источника по ссылке', () => {
    const material = new MeshBasicMaterial()
    const src = source()
    const mesh = createMoonletMesh(src, material, moonlet, ASTEROID_SIZE)
    expect(mesh.count).toBe(1)
    expect(mesh.material).toBe(material)
    expect(mesh.frustumCulled).toBe(false)
    expect(mesh.geometry.getAttribute('position')).toBe(src.getAttribute('position'))
    expect(Array.from(mesh.geometry.getAttribute('instanceFade').array)).toEqual([1])
    expect(Array.from(mesh.geometry.getAttribute('instanceOrigin').array)).toEqual([0, 0, 0])
    const m = new Matrix4()
    mesh.getMatrixAt(0, m)
    // instanceMatrix хранится во Float32
    const expected = moonletMatrix(moonlet, ASTEROID_SIZE).elements
    m.elements.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5))
    expect(mesh.name).toBe('Moonlet:pandora')
  })
})

const ringActor = (moonlets?: unknown[]): Actor =>
  ({
    getAttribute: (key: string) => (key === 'name' ? 'TestRing' : 42),
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, ...(moonlets ? { moonlets } : {}) })
    }
  }) as unknown as Actor

const TETRA: ShapeModelData = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  normals: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3])
}
const storageOf = (data: ShapeModelData | null): ShapeModelStorage =>
  ({ load: vi.fn(async () => data) }) as unknown as ShapeModelStorage
const moonletMeshesOf = (system: AsteroidRingSystem): BufferGeometry[] =>
  system.children.filter((c) => c.name.startsWith('Moonlet:')).map((c) => (c as unknown as { geometry: BufferGeometry }).geometry)
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('лунки в системе кольца', () => {
  it('без хранилища моделей — сразу одна лунка на процедурном архетипе и материале пула', () => {
    const system = new AsteroidRingSystem(ringActor([moonlet]))
    const meshes = system.children.filter((c) => c.name === 'Moonlet:pandora')
    expect(meshes).toHaveLength(1)
    const material = (system as unknown as { pool: { geometryMaterial: unknown } }).pool.geometryMaterial
    expect((meshes[0] as unknown as { material: unknown }).material).toBe(material)
  })

  it('с хранилищем — геометрия из модели по приходу', async () => {
    const system = new AsteroidRingSystem(ringActor([moonlet]), {}, null, storageOf(TETRA))
    expect(moonletMeshesOf(system)).toHaveLength(0)
    await flush()
    const geometries = moonletMeshesOf(system)
    expect(geometries).toHaveLength(1)
    expect(geometries[0].getAttribute('position').count).toBe(TETRA.positions.length / 3)
  })

  it('хранилище вернуло null — лунка на процедурном архетипе', async () => {
    const system = new AsteroidRingSystem(ringActor([moonlet]), {}, null, storageOf(null))
    await flush()
    const geometries = moonletMeshesOf(system)
    expect(geometries).toHaveLength(1)
    expect(geometries[0].getAttribute('position').count).toBeGreaterThan(TETRA.positions.length / 3)
  })

  it('пояс без лунок — ни одного меша Moonlet', () => {
    const system = new AsteroidRingSystem(ringActor())
    expect(system.children.some((c) => c.name.startsWith('Moonlet:'))).toBe(false)
  })
})
