import { describe, expect, it, vi } from 'vitest'
import { InstancedBufferGeometry, MeshBasicMaterial, Sphere, Vector2, Vector3, type BufferGeometry } from 'three'
import {
  allocatePatchArrays,
  applyPatchBounds,
  buildPatchIndex,
  buildTerrainPatchArrays,
  buildTerrainPatchGeometry,
  buildTerrainPatchInto,
  ringGridIndex,
  terrainPatchVertexCount
} from '@/core/terrain/terrainPatchGeometry'
import { TerrainPatchPool } from '@/core/terrain/TerrainPatchPool'
import { cubeFaceDirection } from '@/core/terrain/cubeSphere'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS, type MidbandParams } from '@/core/terrain/midbandParams'
import { detailWrapFor, wrapIndex, wrappedComponent } from '@/core/terrain/detailWrap'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { SpaceScale } from '@/core/constants'

function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}

const R_KM = 1736
// небольшой случайный рельеф — паритет и RTC должны держаться не на константе.
// Полоса ВКЛЮЧЕНА (дефолт, Task 7): мешер теперь читает field.midbandSample
// тем же dir/uv, что и heightMeters/surfaceRadiusUnits — паритет позиции
// вершины держится и с полосой (обе стороны считают карту и полосу одинаково).
function bumpyField(midband?: MidbandParams): TerrainHeightField {
  const values = Array.from({ length: 16 * 8 }, (_, k) => (k * 4001) % 65535)
  return new TerrainHeightField(makeMap(16, 8, values, -2000, 9000), R_KM, midband)
}

const SEGMENTS = 8
const DEPTH = 1
const GRID_VERTEX_COUNT = (SEGMENTS + 1) ** 2

function build(
  field: TerrainHeightField,
  face: number,
  i: number,
  j: number,
  skirtDepthUnits = 0,
  wrap = detailWrapFor(undefined)
) {
  return buildTerrainPatchGeometry(field, face, i, j, DEPTH, SEGMENTS, buildPatchIndex(SEGMENTS), skirtDepthUnits, wrap)
}

/** Патч на явном уровне: при SEGMENTS = 8 уровень 11 даёт шаг ≈ 166 м — как боевой L8 на 64 сегментах (полоса полная). */
function buildAt(
  field: TerrainHeightField,
  depth: number,
  face: number,
  i: number,
  j: number,
  skirtDepthUnits = 0,
  wrap = detailWrapFor(undefined)
) {
  return buildTerrainPatchGeometry(field, face, i, j, depth, SEGMENTS, buildPatchIndex(SEGMENTS), skirtDepthUnits, wrap)
}

/**
 * Направление вершины k ровно так, как его восстанавливает вершинник:
 * normalize(position + patchCenter). Атрибута normal у патча больше нет —
 * направление живёт в позиции и центре патча (диета атрибутов).
 */
function vertexDir(geometry: BufferGeometry, k: number): Vector3 {
  const pos = geometry.getAttribute('position')
  const pc = geometry.getAttribute('patchCenter')

  return new Vector3(pos.getX(k) + pc.getX(0), pos.getY(k) + pc.getY(0), pos.getZ(k) + pc.getZ(0)).normalize()
}

/**
 * Кромочная вершина юбочной: юбка сдвинута строго радиально, направления
 * совпадают до кванта float32 — ищем ближайшее по dot. Раньше кромку искали
 * по побайтной копии uv, атрибута uv у патча больше нет.
 */
function edgeIndexForSkirt(geometry: BufferGeometry, skirt: number): number {
  const target = vertexDir(geometry, skirt)
  let best = -1
  let bestDot = -Infinity
  for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
    const dot = vertexDir(geometry, k).dot(target)
    if (dot > bestDot) {
      bestDot = dot
      best = k
    }
  }
  // не «просто ближайшая», а совпадающая: соседние вершины сетки разведены на
  // ~0.1 рад (dot ≈ 0.99), так что порог дискриминирует промах
  expect(bestDot).toBeGreaterThan(1 - 1e-9)

  return best
}

describe('buildTerrainPatchArrays: ядро без геометрии', () => {
  it('массивы и центр равны fresh-варианту; сфера равна computeBoundingSphere', () => {
    const field = bumpyField()
    const arrays = allocatePatchArrays(SEGMENTS)
    const { center, bounds } = buildTerrainPatchArrays(field, 0, 1, 0, DEPTH, SEGMENTS, 0.001, detailWrapFor(undefined), arrays)
    const { geometry, center: refCenter } = build(field, 0, 1, 0, 0.001)
    expect(center.toArray()).toEqual(refCenter.toArray())
    for (const [name, arr] of [['position', arrays.positions], ['detailPos', arrays.detailPos], ['detailPos2', arrays.detailPos2], ['height', arrays.heights], ['midTilt', arrays.midTilts], ['midShade', arrays.midShades]] as const) {
      expect(arr).toEqual(geometry.getAttribute(name).array)
    }
    const ref = new Sphere()
    geometry.computeBoundingSphere()
    ref.copy(geometry.boundingSphere!)
    expect(bounds.cx).toBeCloseTo(ref.center.x, 9)
    expect(bounds.cy).toBeCloseTo(ref.center.y, 9)
    expect(bounds.cz).toBeCloseTo(ref.center.z, 9)
    expect(bounds.radius).toBeCloseTo(ref.radius, 9)
  })

  it('applyPatchBounds ставит сферу без обхода вершин; fresh и into не зовут computeBoundingSphere', () => {
    // шпион на прототипе ДО постройки — иначе он не видит вызовы из самих
    // обёрток (build() уже создал бы свою геометрию раньше vi.spyOn на инстансе)
    const spy = vi.spyOn(InstancedBufferGeometry.prototype, 'computeBoundingSphere')
    try {
      const field = bumpyField()
      const wrap = detailWrapFor(undefined)

      const fresh = build(field, 0, 1, 0) // fresh-вариант

      const pool = new TerrainPatchPool(new MeshBasicMaterial(), SEGMENTS)
      const handle = pool.acquire()!
      buildTerrainPatchInto(field, 0, 1, 0, DEPTH, SEGMENTS, 0.001, handle, wrap) // into-вариант

      expect(spy).not.toHaveBeenCalled()

      applyPatchBounds(fresh.geometry, { cx: 1, cy: 2, cz: 3, radius: 4 })
      expect(fresh.geometry.boundingSphere!.center.toArray()).toEqual([1, 2, 3])
      expect(fresh.geometry.boundingSphere!.radius).toBe(4)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('buildPatchIndex', () => {
  it('segments² квадов по два треугольника + юбочная полоса, Uint16', () => {
    const index = buildPatchIndex(SEGMENTS)
    const ringCount = 4 * SEGMENTS
    expect(index.count).toBe(SEGMENTS * SEGMENTS * 6 + ringCount * 6)
    expect(index.array).toBeInstanceOf(Uint16Array)
  })

  it('обмотка первого треугольника — наружу (CCW при взгляде извне)', () => {
    const field = bumpyField()
    const { geometry, center } = build(field, 4, 0, 0)
    const pos = geometry.getAttribute('position')
    const idx = geometry.getIndex()!

    const p = (k: number): Vector3 =>
      new Vector3(pos.getX(idx.getX(k)), pos.getY(idx.getX(k)), pos.getZ(idx.getX(k))).add(center)
    const a = p(0)
    const faceNormal = p(1).clone().sub(a).cross(p(2).clone().sub(a))
    expect(faceNormal.dot(a)).toBeGreaterThan(0)
  })
})

describe('buildTerrainPatchGeometry: RTC и паритет с коллизией', () => {
  it('позиция ноды + относительная вершина == точка поверхности surfaceRadiusUnits(dir)', () => {
    const field = bumpyField()
    // уровень 11: шаг ≈ 166 м, все октавы полосы представимы — мешер несёт её
    // целиком, как и surfaceRadiusUnits (коллизия уровня не знает и видит
    // полную полосу). На грубом уровне расхождение законно — см. тест веса полосы
    const { geometry, center } = buildAt(field, 11, 0, 1, 0)
    const pos = geometry.getAttribute('position')

    // паритет — инвариант СЕТОЧНЫХ вершин; юбочные намеренно проседают под
    // поверхность (см. describe «юбка патча»)
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      const absolute = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).add(center)
      const dir = absolute.clone().normalize()
      // паритет мешер↔коллизия: та же каноническая функция высоты
      expect(absolute.length()).toBeCloseTo(field.surfaceRadiusUnits(dir), 6)
    }
  })

  it('normalize(position + patchCenter) — радиальное направление вершины (сетка и юбка), patchCenter = center билдера', () => {
    // Потребитель: вершинник (vLocalDir = normalize(position + patchCenter)) и
    // через него весь TBN slope-шейдинга. Атрибут normal снят диетой — если бы
    // направление перестало совпадать с честным dir параметров вершины, TBN
    // сломался бы так же, как ломался на RTC-position (см. HeightNormal.spec)
    const field = bumpyField()
    const FACE = 3
    const I = 1
    const J = 0
    const SKIRT = 0.001
    const { geometry, center } = build(field, FACE, I, J, SKIRT)
    const pc = geometry.getAttribute('patchCenter')

    expect(pc.count).toBe(1)
    expect([pc.getX(0), pc.getY(0), pc.getZ(0)]).toEqual([
      Math.fround(center.x),
      Math.fround(center.y),
      Math.fround(center.z)
    ])

    // честное направление — из ПАРАМЕТРОВ вершины (та же арифметика, что в мешере)
    const span = 2 / (1 << DEPTH)
    const s0 = -1 + I * span
    const t0 = -1 + J * span
    const honest = new Vector3()
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      const a = k % (SEGMENTS + 1)
      const b = Math.floor(k / (SEGMENTS + 1))
      cubeFaceDirection(FACE, s0 + (span * a) / SEGMENTS, t0 + (span * b) / SEGMENTS, honest)
      expect(vertexDir(geometry, k).distanceTo(honest)).toBeLessThan(1e-6)
    }

    // юбочная вершина сдвинута строго радиально — направление совпадает с
    // кромочной вершиной ТОГО ЖЕ витка кольца (ringGridIndex): порядок юбки
    // не разъезжается с обходом периметра
    for (let ring = 0; ring < SEGMENTS * 4; ring++) {
      const skirt = GRID_VERTEX_COUNT + ring
      expect(edgeIndexForSkirt(geometry, skirt)).toBe(ringGridIndex(ring, SEGMENTS))
    }
  })

  it('RTC: относительные позиции малы против радиуса, bounding-сфера конечна', () => {
    const field = bumpyField()
    const { geometry } = build(field, 2, 0, 1)
    const pos = geometry.getAttribute('position')

    let maxLen = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      maxLen = Math.max(maxLen, new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).length())
    }
    // патч глубины 1 стягивает ~четверть грани: относительные позиции — доли радиуса
    expect(maxLen).toBeLessThan(field.surfaceRadiusUnits(new Vector3(0, 1, 0)))
    expect(geometry.boundingSphere).not.toBeNull()
    expect(Number.isFinite(geometry.boundingSphere!.radius)).toBe(true)
  })

  it('вершины общего ребра соседних патчей одной грани совпадают побайтно', () => {
    const field = bumpyField()
    const left = build(field, 4, 0, 0)
    const right = build(field, 4, 1, 0)
    const lp = left.geometry.getAttribute('position')
    const rp = right.geometry.getAttribute('position')

    // правое ребро левого патча (a = SEGMENTS) против левого ребра правого (a = 0)
    for (let b = 0; b <= SEGMENTS; b++) {
      const kL = b * (SEGMENTS + 1) + SEGMENTS
      const kR = b * (SEGMENTS + 1)
      const absL = new Vector3(lp.getX(kL), lp.getY(kL), lp.getZ(kL)).add(left.center)
      const absR = new Vector3(rp.getX(kR), rp.getY(kR), rp.getZ(kR)).add(right.center)
      // f32-квантование RTC-центров: eps32·|rel| ≈ 1e-8 юнита (~сантиметры на Луне); допуск 2e-7 (~0.4 м) — на порядки меньше текселя карты
      expect(absL.distanceTo(absR)).toBeLessThan(2e-7)
    }
  })

  it('вершины общего ребра куба (+Y/−Z) совпадают в абсолютных координатах при развороте параметра', () => {
    const field = bumpyField()
    const index = buildPatchIndex(SEGMENTS)
    // depth=0: один патч на грань — общее ребро граней целиком в одном патче с каждой стороны
    const wrap = detailWrapFor(undefined)
    const topY = buildTerrainPatchGeometry(field, 2, 0, 0, 0, SEGMENTS, index, 0, wrap) // +Y, t=+1 — общее ребро с −Z
    const backZ = buildTerrainPatchGeometry(field, 5, 0, 0, 0, SEGMENTS, index, 0, wrap) // −Z, t=+1 — общее ребро с +Y
    const topPos = topY.geometry.getAttribute('position')
    const backPos = backZ.geometry.getAttribute('position')

    // строка b=SEGMENTS (t=+1) у обеих граней. su=tan(π/4·s) — нечётная функция,
    // поэтому su=-su' точно при s=-s': параметризация общего ребра развёрнута
    // (правые базисы граней), индекс столбца зеркалится a' = SEGMENTS-a
    for (let a = 0; a <= SEGMENTS; a++) {
      const aMirror = SEGMENTS - a
      const kTop = SEGMENTS * (SEGMENTS + 1) + a
      const kBack = SEGMENTS * (SEGMENTS + 1) + aMirror

      const absTop = new Vector3(topPos.getX(kTop), topPos.getY(kTop), topPos.getZ(kTop)).add(topY.center)
      const absBack = new Vector3(backPos.getX(kBack), backPos.getY(kBack), backPos.getZ(kBack)).add(backZ.center)

      // тот же допуск, что у побайтного внутригранного теста, с запасом на
      // асимметрию вычислений equal-angle проекции по разным базисам граней
      expect(absTop.distanceTo(absBack)).toBeLessThan(2e-7)
    }
  })
})

describe('buildTerrainPatchGeometry: развёртка вершинных направлений', () => {
  // Атрибута uv у патча больше нет (диета): развёртку считает ФРАГМЕНТНИК из
  // vLocalDir (чанк terrainUvFunctions, пины в FragmentUv.spec/WaterMaterial.spec),
  // а вершина несёт только направление. Здесь проверяется, что направления,
  // восстановленные как в вершиннике, дают вменяемую развёртку: непрерывную
  // по долготе внутри шовного патча и с картным v (север = 0).
  it('dirToUv непрерывна по долготе внутри шовного патча (mod 1) и северное полушарие даёт v карты < 0.5', () => {
    const field = bumpyField()
    const uv = new Vector2()

    // −X-грань содержит меридиан u=0/1 (dir=(−1,0,0) → phi=0)
    const seam = build(field, 1, 0, 0).geometry
    let prevU = NaN
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      field.dirToUv(vertexDir(seam, k), uv)
      if (!Number.isNaN(prevU) && k % (SEGMENTS + 1) !== 0) {
        const d = Math.abs(uv.x - prevU)
        // шаг сетки по долготе много меньше 0.1 оборота: скачок больше —
        // разрыв развёртки, а не шаг (обход по строкам, стыки строк пропущены)
        expect(Math.min(d, 1 - d)).toBeLessThan(0.1)
      }
      prevU = uv.x
    }

    // +Y-грань — вся в северном полушарии; dirToUv отдаёт v КАРТЫ (строка 0 =
    // север), флип на текстурное v делает фрагментник (1.0 - acos(...)/π)
    const north = build(field, 2, 0, 0).geometry
    let checked = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      const dir = vertexDir(north, k)
      if (dir.y <= 0) continue
      field.dirToUv(dir, uv)
      expect(uv.y).toBeLessThan(0.5)
      checked++
    }
    expect(checked).toBe(GRID_VERTEX_COUNT)
  })
})

describe('юбка патча', () => {
  const SKIRT = 0.001 // юниты
  // глубже общего DEPTH=1: RTC-позиции патча тем мельче, чем глубже дерево —
  // на DEPTH=1 квантование float32 относительной позиции (~0.1 юнита) даёт
  // шум ~8e-9 в разности длин edge/skirt, перебивая допуск теста 5e-10;
  // на DEPTH=7 позиции меньше на два порядка, шум падает пропорционально
  const SKIRT_TEST_DEPTH = 7

  function buildFieldPatch() {
    return buildTerrainPatchGeometry(
      bumpyField(),
      4,
      0,
      0,
      SKIRT_TEST_DEPTH,
      SEGMENTS,
      buildPatchIndex(SEGMENTS),
      SKIRT,
      detailWrapFor(undefined)
    )
  }

  it('счётчики: 4481 вершина, индекс = сетка + 256 квадов юбки', () => {
    const index = buildPatchIndex(SEGMENTS) // SEGMENTS=8 в этом спеке → 81 + 32 кольцевых, 32 юбочных квада
    const ringCount = 4 * SEGMENTS
    expect(index.count).toBe(SEGMENTS * SEGMENTS * 6 + ringCount * 6)
    const { geometry } = buildFieldPatch() // хелпер: build(field, 4, 0, 0) с skirtDepthUnits=SKIRT
    expect(geometry.getAttribute('position').count).toBe(terrainPatchVertexCount(SEGMENTS))
  })

  it('юбочная вершина ниже своей кромочной ровно на skirtDepthUnits, направление то же', () => {
    const { geometry, center } = buildFieldPatch()
    const pos = geometry.getAttribute('position')
    const gridCount = (SEGMENTS + 1) ** 2

    // первая кольцевая вершина соответствует кромочной (a=0,b=0) = сеточный индекс 0
    const edge = new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)).add(center)
    const skirt = new Vector3(pos.getX(gridCount), pos.getY(gridCount), pos.getZ(gridCount)).add(center)
    expect(edge.length() - skirt.length()).toBeCloseTo(SKIRT, 9)
    expect(skirt.clone().normalize().distanceTo(edge.clone().normalize())).toBeLessThan(1e-9)
    // направление юбочной вершины (для вершинника — normalize(pos+patchCenter)) — кромочное
    expect(vertexDir(geometry, gridCount).distanceTo(vertexDir(geometry, 0))).toBeLessThan(1e-9)
  })

  it('юбочные треугольники обмотаны наружу (от центра патча по касательной)', () => {
    // юбка — вертикальная стенка: «наружу» = от оси патча; проверяем проекцию
    // нормали треугольника на касательное направление центр→кромка
    const { geometry, center } = buildFieldPatch()
    const idx = geometry.getIndex()!
    const pos = geometry.getAttribute('position')
    const centerDir = center.clone().normalize()
    const gridIndexCount = SEGMENTS * SEGMENTS * 6

    const vertexAt = (n: number): Vector3 =>
      new Vector3(pos.getX(idx.getX(n)), pos.getY(idx.getX(n)), pos.getZ(idx.getX(n))).add(center)

    let checked = 0
    for (let k = gridIndexCount; k < idx.count; k += 3) {
      const a = vertexAt(k)
      const b = vertexAt(k + 1)
      const c = vertexAt(k + 2)
      const triangleNormal = b.clone().sub(a).cross(c.clone().sub(a))

      const edgeDir = a.clone().normalize()
      const outward = edgeDir.clone().addScaledVector(centerDir, -edgeDir.dot(centerDir))
      if (outward.lengthSq() < 1e-12) continue // треугольник у самого центра дуги — направление вырождено

      expect(triangleNormal.dot(outward.normalize())).toBeGreaterThan(0)
      checked++
    }
    expect(checked).toBeGreaterThan(SEGMENTS * 4) // почти все юбочные треугольники проверены
  })
})

describe('buildTerrainPatchGeometry: атрибуты домена детали', () => {
  const wrap = detailWrapFor(undefined)

  it('detailPos = тело-локальная позиция − k·W, k общий на патч (от центра)', () => {
    const field = bumpyField()
    const { geometry, center } = build(field, 0, 1, 0)
    const pos = geometry.getAttribute('position')
    const d1 = geometry.getAttribute('detailPos')
    const d2 = geometry.getAttribute('detailPos2')
    expect(d1.itemSize).toBe(3)
    expect(d2.count).toBe(pos.count)
    const k1 = [wrapIndex(center.x, wrap.w1), wrapIndex(center.y, wrap.w1), wrapIndex(center.z, wrap.w1)]
    const k2 = [wrapIndex(center.x, wrap.w2), wrapIndex(center.y, wrap.w2), wrapIndex(center.z, wrap.w2)]
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      const p = [pos.getX(k) + center.x, pos.getY(k) + center.y, pos.getZ(k) + center.z]
      for (let c = 0; c < 3; c++) {
        expect(d1.array[k * 3 + c]).toBeCloseTo(wrappedComponent(p[c], k1[c], wrap.w1), 6)
        expect(d2.array[k * 3 + c]).toBeCloseTo(wrappedComponent(p[c], k2[c], wrap.w2), 6)
      }
    }
  })

  it('юбочная вершина несёт позицию своей кромочной (радиальный сдвиг юбки не входит)', () => {
    const { geometry } = build(bumpyField(), 0, 1, 0, 0.001)
    const d1 = geometry.getAttribute('detailPos')
    const ring = SEGMENTS * 4
    for (let r = 0; r < ring; r++) {
      const skirt = GRID_VERTEX_COUNT + r
      // кромочный индекс — тот же обход, что у юбки (ringGridIndex); ищем
      // кромку по совпадению направления (юбка сдвинута строго радиально)
      const edge = edgeIndexForSkirt(geometry, skirt)
      for (let c = 0; c < 3; c++) expect(d1.array[skirt * 3 + c]).toBe(d1.array[edge * 3 + c])
    }
  })

  it('общая точка двух соседних патчей: значения отличаются на кратное W по каждой оси', () => {
    const field = bumpyField()
    const a = build(field, 0, 0, 0)
    const b = build(field, 0, 1, 0)
    const da = a.geometry.getAttribute('detailPos')
    const db = b.geometry.getAttribute('detailPos')
    // правое ребро a (a = SEGMENTS) и левое ребро b (a = 0), та же строка b=0
    const ia = SEGMENTS, ib = 0
    const q: number[] = []
    for (let c = 0; c < 3; c++) {
      q[c] = (da.array[ia * 3 + c] - db.array[ib * 3 + c]) / wrap.w1
      expect(Math.abs(q[c] - Math.round(q[c]))).toBeLessThan(1e-3)
    }
    // k общий НА ПАТЧ (от центра), не на вершину — иначе q было бы кратным W
    // тривиально (тождественно 0) на любых соседях, тест ничего бы не ловил
    expect(q.some((v) => Math.round(v) !== 0)).toBe(true)
  })

  it('|detailPos| ≤ W/2 + радиус патча на глубине 8 (round() гарантирует полупериод) — float32 держит миллиметры', () => {
    const field = bumpyField()
    const DEEP_DEPTH = 8
    const { geometry } = buildTerrainPatchGeometry(
      field,
      0,
      100,
      100,
      DEEP_DEPTH,
      SEGMENTS,
      buildPatchIndex(SEGMENTS),
      0,
      wrap
    )
    const pos = geometry.getAttribute('position')
    const d1 = geometry.getAttribute('detailPos')
    const d2 = geometry.getAttribute('detailPos2')

    let patchRadius = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      patchRadius = Math.max(patchRadius, new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).length())
    }

    let maxD1 = 0
    let maxD2 = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      for (let c = 0; c < 3; c++) {
        maxD1 = Math.max(maxD1, Math.abs(d1.array[k * 3 + c]))
        maxD2 = Math.max(maxD2, Math.abs(d2.array[k * 3 + c]))
      }
    }

    expect(maxD1).toBeLessThan(wrap.w1 / 2 + patchRadius)
    expect(maxD2).toBeLessThan(wrap.w2 / 2 + patchRadius)
  })
})

describe('buildTerrainPatchGeometry: атрибут height', () => {
  it('height = метры над референсом той же вершины, что и позиция (полоса выключена)', () => {
    const { geometry, center } = build(bumpyField({ ...MIDBAND_DEFAULTS, midbandStrength: 0 }), 0, 1, 0)
    const pos = geometry.getAttribute('position')
    const height = geometry.getAttribute('height')
    expect(height.itemSize).toBe(1)
    expect(height.count).toBe(pos.count)
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      const r = Math.hypot(pos.getX(k) + center.x, pos.getY(k) + center.y, pos.getZ(k) + center.z)
      const metersFromPosition = (r / SpaceScale - R_KM) * 1000
      // float32 позиции ~0.87 юнита → ~0.2 м; допуск 2 м
      expect(Math.abs(height.getX(k) - metersFromPosition)).toBeLessThan(2)
    }
    // не константа: рельеф bumpyField случайный
    const values = Array.from({ length: GRID_VERTEX_COUNT }, (_, k) => height.getX(k))
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(100)
  })

  it('с полосой height — высота КАРТЫ (фаза террас без бугров полосы), позиция — карта + полоса', () => {
    const field = bumpyField()
    const { geometry, center } = buildAt(field, 11, 0, 1, 0)
    const pos = geometry.getAttribute('position')
    const height = geometry.getAttribute('height')
    const dir = new Vector3()
    let maxBand = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      dir.set(pos.getX(k) + center.x, pos.getY(k) + center.y, pos.getZ(k) + center.z)
      const r = dir.length()
      dir.divideScalar(r)
      expect(Math.abs(height.getX(k) - field.mapHeightMeters(dir))).toBeLessThan(1e-3)
      const metersFromPosition = (r / SpaceScale - R_KM) * 1000
      maxBand = Math.max(maxBand, Math.abs(metersFromPosition - height.getX(k)))
    }
    // позиция несёт полосу: расхождение с картой заметно больше кванта float32 (~0.2 м)
    expect(maxBand).toBeGreaterThan(5)
    // maxHeightWithMidbandMeters = maxMeters карты (9000) + maxAmplitude полосы
    expect(maxBand).toBeLessThanOrEqual(field.maxHeightWithMidbandMeters - 9000 + 2)
  })

  it('позиция вершины несёт полосу, взвешенную по шагу уровня: на грубом уровне отличается от полной полосы', () => {
    const field = bumpyField()
    const { geometry, center } = build(field, 0, 1, 0)
    const pos = geometry.getAttribute('position')
    const dir = new Vector3()
    const uv = new Vector2()
    const out = { heightMeters: 0, tiltE: 0, tiltN: 0, octaveWeightSum: 0, envelope: 0 }
    let maxLevelDiff = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      dir.set(pos.getX(k) + center.x, pos.getY(k) + center.y, pos.getZ(k) + center.z)
      const r = dir.length()
      dir.divideScalar(r)
      field.dirToUv(dir, uv)
      const mapMeters = field.sampleMeters(uv.x, uv.y)
      const expected = mapMeters + field.midbandSample(dir, uv.x, uv.y, mapMeters, out, field.vertexStepMeters(DEPTH, SEGMENTS)).heightMeters
      const metersFromPosition = (r / SpaceScale - R_KM) * 1000
      expect(Math.abs(metersFromPosition - expected)).toBeLessThan(2)
      maxLevelDiff = Math.max(maxLevelDiff, Math.abs(expected - field.heightMeters(dir)))
    }
    expect(maxLevelDiff).toBeGreaterThan(1) // на DEPTH шаг ≫ λ₀: полоса на вершине не полная
  })

  it('юбочная вершина несёт высоту своей кромочной (радиальный сдвиг юбки не входит)', () => {
    const { geometry } = build(bumpyField(), 0, 1, 0, 0.001)
    const height = geometry.getAttribute('height')
    const ring = SEGMENTS * 4
    for (let r = 0; r < ring; r++) {
      const skirt = GRID_VERTEX_COUNT + r
      const edge = edgeIndexForSkirt(geometry, skirt)
      expect(height.getX(skirt)).toBe(height.getX(edge))
    }
  })
})

describe('buildTerrainPatchGeometry: атрибут midTilt', () => {
  it('midTilt = midbandTilt поля в направлении вершины', () => {
    const field = bumpyField()
    const { geometry, center } = buildAt(field, 11, 0, 1, 0)
    const pos = geometry.getAttribute('position')
    const tilt = geometry.getAttribute('midTilt')
    expect(tilt.itemSize).toBe(2)
    expect(tilt.count).toBe(pos.count)
    const expected = new Vector2()
    let nonZero = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      const dir = new Vector3(pos.getX(k) + center.x, pos.getY(k) + center.y, pos.getZ(k) + center.z).normalize()
      field.midbandTilt(dir, expected, field.vertexStepMeters(11, SEGMENTS))
      expect(Math.abs(tilt.getX(k) - expected.x)).toBeLessThan(1e-4)
      expect(Math.abs(tilt.getY(k) - expected.y)).toBeLessThan(1e-4)
      if (expected.lengthSq() > 0) nonZero++
    }
    expect(nonZero).toBeGreaterThan(GRID_VERTEX_COUNT / 2)
  })

  it('юбочная вершина несёт midTilt своей кромочной', () => {
    const { geometry } = build(bumpyField(), 0, 1, 0, 0.001)
    const tilt = geometry.getAttribute('midTilt')
    for (let r = 0; r < SEGMENTS * 4; r++) {
      const skirt = GRID_VERTEX_COUNT + r
      const edge = edgeIndexForSkirt(geometry, skirt)
      expect(tilt.getX(skirt)).toBe(tilt.getX(edge))
      expect(tilt.getY(skirt)).toBe(tilt.getY(edge))
    }
  })
})

describe('buildTerrainPatchGeometry: атрибут midShade', () => {
  it('midShade.x = высота полосы / maxAmplitude, .y = доля октав уровня × огибающая; без полосы — нули', () => {
    const field = bumpyField()
    const { geometry, center } = buildAt(field, 11, 0, 1, 0)
    const pos = geometry.getAttribute('position')
    const shade = geometry.getAttribute('midShade')
    expect(shade.itemSize).toBe(2)
    expect(shade.count).toBe(pos.count)
    const dir = new Vector3()
    const uv = new Vector2()
    const out = { heightMeters: 0, tiltE: 0, tiltN: 0, octaveWeightSum: 0, envelope: 0 }
    let nonZero = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      dir.set(pos.getX(k) + center.x, pos.getY(k) + center.y, pos.getZ(k) + center.z).normalize()
      field.dirToUv(dir, uv)
      const band = field.midbandSample(dir, uv.x, uv.y, field.sampleMeters(uv.x, uv.y), out, field.vertexStepMeters(11, SEGMENTS))
      expect(shade.getX(k)).toBeCloseTo(band.heightMeters / field.midbandMaxAmplitudeMeters, 5)
      expect(shade.getY(k)).toBeCloseTo(band.octaveWeightSum * Math.min(1, band.envelope), 6)
      expect(Math.abs(shade.getX(k))).toBeLessThanOrEqual(1 + 1e-6)
      if (shade.getX(k) !== 0) nonZero++
    }
    expect(nonZero).toBeGreaterThan(GRID_VERTEX_COUNT / 4)
    const off = buildAt(bumpyField({ ...MIDBAND_DEFAULTS, midbandStrength: 0 }), 11, 0, 1, 0).geometry.getAttribute('midShade')
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      expect(off.getX(k)).toBe(0)
      expect(off.getY(k)).toBe(0)
    }
  })

  // промежуточный уровень: часть октав шагом уже не представима — .y обязан
  // быть строго между 0 и 1, иначе «LOD-осознанность» гейта не проверена
  it('уровень 9: .y строго в (0, 1) — доля октав уровня, взвешенная огибающей', () => {
    const field = bumpyField()
    const { geometry, center } = buildAt(field, 9, 0, 1, 0)
    const pos = geometry.getAttribute('position')
    const shade = geometry.getAttribute('midShade')
    const dir = new Vector3()
    const uv = new Vector2()
    const out = { heightMeters: 0, tiltE: 0, tiltN: 0, octaveWeightSum: 0, envelope: 0 }
    let between = 0
    for (let k = 0; k < GRID_VERTEX_COUNT; k++) {
      dir.set(pos.getX(k) + center.x, pos.getY(k) + center.y, pos.getZ(k) + center.z).normalize()
      field.dirToUv(dir, uv)
      const band = field.midbandSample(dir, uv.x, uv.y, field.sampleMeters(uv.x, uv.y), out, field.vertexStepMeters(9, SEGMENTS))
      expect(shade.getY(k)).toBeCloseTo(band.octaveWeightSum * Math.min(1, band.envelope), 6)
      if (shade.getY(k) > 1e-6 && shade.getY(k) < 1 - 1e-6) between++
    }
    expect(between).toBeGreaterThan(0)
  })

  it('юбочная вершина несёт midShade своей кромочной', () => {
    // уровень 11, а не DEPTH: на грубом уровне весь атрибут нулевой и пин пуст
    const { geometry } = buildAt(bumpyField(), 11, 0, 1, 0, 0.001)
    const shade = geometry.getAttribute('midShade')
    let nonZero = 0
    for (let r = 0; r < SEGMENTS * 4; r++) {
      const skirt = GRID_VERTEX_COUNT + r
      const edge = edgeIndexForSkirt(geometry, skirt)
      expect(shade.getX(skirt)).toBe(shade.getX(edge))
      expect(shade.getY(skirt)).toBe(shade.getY(edge))
      if (shade.getX(skirt) !== 0 || shade.getY(skirt) !== 0) nonZero++
    }
    expect(nonZero).toBeGreaterThan(0)
  })
})
