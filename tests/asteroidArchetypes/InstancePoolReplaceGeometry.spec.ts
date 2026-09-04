import { BoxGeometry, BufferAttribute, BufferGeometry, InstancedBufferAttribute } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const K = 2
const makeGeometries = () => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))

const realGeometry = (): BufferGeometry => {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]), 3))
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]), 3))
  g.setAttribute('surfaceData', new BufferAttribute(new Float32Array(12), 4))
  g.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1))
  return g
}

describe('InstancePool.replaceArchetypeGeometry: подмена геометрии стрима по приходу реальной модели', () => {
  it('меняет геометрию L0- и Near-стрима архетипа k, сохраняя буфер instanceFade и живые инстансы', () => {
    const pool = new InstancePool({ maxInstances: 40 }, { maxInstances: 20 }, { maxInstances: 10 }, makeGeometries(), makeGeometries(), 2)
    const l0Mesh = pool.geometryMeshes[1]
    const fadeBefore = l0Mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute
    fadeBefore.setX(3, 0.5)
    l0Mesh.count = 5

    pool.replaceArchetypeGeometry(1, realGeometry(), realGeometry())

    const l0After = pool.geometryMeshes[1]
    expect(l0After).toBe(l0Mesh) // сам меш и его матрицы инстансов на месте
    expect(l0After.count).toBe(5)
    expect(l0After.geometry.getAttribute('position').count).toBe(3)
    expect(l0After.geometry.getIndex()!.count).toBe(3)
    // Буфер fade — тот же объект: пер-инстансные значения не потеряны
    const fadeAfter = l0After.geometry.getAttribute('instanceFade') as InstancedBufferAttribute
    expect(fadeAfter).toBe(fadeBefore)
    expect(fadeAfter.getX(3)).toBe(0.5)
    // Near-стрим того же архетипа тоже подменён
    expect(pool.nearMeshes[1].geometry.getAttribute('position').count).toBe(3)
    // Соседний архетип не тронут
    expect(pool.geometryMeshes[0].geometry.getAttribute('position').count).toBe(24)
  })

  it('старая геометрия стрима освобождается, исходная геометрия архетипа не трогается', () => {
    const sources = makeGeometries()
    const pool = new InstancePool({ maxInstances: 40 }, { maxInstances: 20 }, { maxInstances: 10 }, sources, makeGeometries(), 2)
    const oldStreamGeometry = pool.geometryMeshes[0].geometry
    let disposed = 0
    oldStreamGeometry.addEventListener('dispose', () => disposed++)

    pool.replaceArchetypeGeometry(0, realGeometry(), realGeometry())

    expect(disposed).toBe(1)
    expect(sources[0].getAttribute('position').count).toBe(24)
  })
})
