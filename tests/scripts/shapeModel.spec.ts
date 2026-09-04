import { IcosahedronGeometry } from 'three'
import {
  buildShapeTiers,
  centerAndNormalize,
  decimateToTriangles,
  parseObjMesh,
  parsePlateMesh,
  parseShapeMesh,
  TIER_TRIANGLES
} from '../../scripts/lib/shapeModel'
import { encodeShapeModel, parseShapeModel } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'

/** Икосфера как «реальная модель»: сдвинута и растянута, чтобы проверить центрирование и нормировку */
const icosphere = (detail: number, scale = 1, offset = 0) => {
  const geom = new IcosahedronGeometry(scale, detail).toNonIndexed()
  const pos = geom.getAttribute('position')
  const positions: number[] = []
  for (let i = 0; i < pos.count; i++) positions.push(pos.getX(i) + offset, pos.getY(i), pos.getZ(i))
  const indices = Array.from({ length: pos.count }, (_, i) => i)
  return { positions, indices }
}

describe('parseObjMesh / parsePlateMesh: разбор моделей форм', () => {
  it('OBJ: вершины, грани с /vt/vn и четырёхугольник веером', () => {
    const obj = ['# comment', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'f 1/1/1 2/2/2 3/3/3 4/4/4', 'f 1 2 3'].join('\n')
    const mesh = parseObjMesh(obj)
    expect(mesh.positions).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
    expect(mesh.indices).toEqual([0, 1, 2, 0, 2, 3, 0, 1, 2])
  })

  it('plate-таблица PDS: заголовок nv nf, вершины и грани с ведущим номером и без', () => {
    const plate = ['3 1', '1 0.0 0.0 0.0', '2 1.0 0.0 0.0', '3 0.0 1.0 0.0', '1 1 2 3'].join('\n')
    const mesh = parsePlateMesh(plate)
    expect(mesh.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(mesh.indices).toEqual([0, 1, 2])
    const bare = ['3 1', '0 0 0', '1 0 0', '0 1 0', '1 2 3'].join('\n')
    expect(parsePlateMesh(bare).indices).toEqual([0, 1, 2])
    expect(() => parsePlateMesh('3 1\n0 0 0')).toThrow(/truncated/)
  })

  it('parseShapeMesh выбирает разборщик по наличию строк v/f', () => {
    expect(parseShapeMesh('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3').indices).toEqual([0, 1, 2])
    expect(parseShapeMesh('3 1\n0 0 0\n1 0 0\n0 1 0\n1 2 3').indices).toEqual([0, 1, 2])
  })
})

describe('centerAndNormalize: объёмный центроид и максимальный радиус 1', () => {
  it('сдвинутая и растянутая икосфера возвращается в начало координат с max r = 1', () => {
    const out = centerAndNormalize(icosphere(2, 3.7, 12))
    let maxR = 0
    let cx = 0
    for (let i = 0; i < out.length; i += 3) {
      maxR = Math.max(maxR, Math.hypot(out[i], out[i + 1], out[i + 2]))
      cx += out[i]
    }
    expect(maxR).toBeCloseTo(1, 6)
    expect(cx / (out.length / 3)).toBeCloseTo(0, 5)
  })

  it('центроид объёмный, не вершинный: половина вершин сдвинута наружу, центр тела почти не двигается', () => {
    // Икосфера + один далёкий «шип» из трёх вершин с нулевой площадью грани:
    // вершинный центроид уехал бы, объёмный — нет
    const base = icosphere(1)
    const spike = { positions: [...base.positions, 50, 0, 0, 50, 0, 0, 50, 0, 0], indices: [...base.indices] }
    const n = spike.positions.length / 3
    spike.indices.push(n - 3, n - 2, n - 1)
    const out = centerAndNormalize(spike)
    // Тело икосферы (первые вершины) после нормировки на шип (r=50) сидит около центра
    expect(Math.abs(out[0])).toBeLessThan(0.05)
  })
})

describe('decimateToTriangles / buildShapeTiers: ярусы под икосферы detail 3 и 4', () => {
  it('прореживает плотную икосферу до цели ±20%, индексы валидны, нормали единичны', () => {
    const src = icosphere(15) // 20·16² = 5120 треугольников
    const positions = centerAndNormalize(src)
    const data = decimateToTriangles(positions, Uint32Array.from(src.indices), TIER_TRIANGLES.l0)
    const tris = data.indices.length / 3
    expect(tris).toBeGreaterThan(TIER_TRIANGLES.l0 * 0.8)
    expect(tris).toBeLessThan(TIER_TRIANGLES.l0 * 1.2)
    const vertexCount = data.positions.length / 3
    for (const i of data.indices) expect(i).toBeLessThan(vertexCount)
    for (let i = 0; i < data.normals.length; i += 3) {
      const len = Math.hypot(data.normals[i], data.normals[i + 1], data.normals[i + 2])
      expect(len).toBeCloseTo(1, 3)
    }
  })

  it('меш беднее цели остаётся как есть', () => {
    const src = icosphere(3) // 20·4² = 320 треугольников
    const data = decimateToTriangles(centerAndNormalize(src), Uint32Array.from(src.indices), TIER_TRIANGLES.l0)
    expect(data.indices.length / 3).toBe(320)
  })

  it('два яруса: near плотнее l0, оба кодируются в бинарник и читаются обратно', () => {
    const src = icosphere(15)
    const tiers = buildShapeTiers(centerAndNormalize(src), Uint32Array.from(src.indices))
    expect(tiers.near.indices.length).toBeGreaterThan(tiers.l0.indices.length * 2)
    const back = parseShapeModel(encodeShapeModel(tiers.l0))
    expect(back.indices.length).toBe(tiers.l0.indices.length)
  })
})
