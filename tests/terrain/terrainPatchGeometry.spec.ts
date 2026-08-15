import { describe, expect, it } from 'vitest'
import { Vector2, Vector3 } from 'three'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}

const R_KM = 1736
// небольшой случайный рельеф — паритет и RTC должны держаться не на константе
function bumpyField(): TerrainHeightField {
  const values = Array.from({ length: 16 * 8 }, (_, k) => (k * 4001) % 65535)
  return new TerrainHeightField(makeMap(16, 8, values, -2000, 9000), R_KM)
}

const SEGMENTS = 8
const DEPTH = 1

function build(field: TerrainHeightField, face: number, i: number, j: number) {
  return buildTerrainPatchGeometry(field, face, i, j, DEPTH, SEGMENTS, buildPatchIndex(SEGMENTS))
}

describe('buildPatchIndex', () => {
  it('segments² квадов по два треугольника, Uint16', () => {
    const index = buildPatchIndex(SEGMENTS)
    expect(index.count).toBe(SEGMENTS * SEGMENTS * 6)
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
    const { geometry, center } = build(field, 0, 1, 0)
    const pos = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')

    for (let k = 0; k < pos.count; k++) {
      const absolute = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).add(center)
      const dir = absolute.clone().normalize()
      // паритет мешер↔коллизия: та же каноническая функция высоты
      expect(absolute.length()).toBeCloseTo(field.surfaceRadiusUnits(dir), 6)
      // нормали радиальные — наклон шейдит slope-карта
      expect(new Vector3(normals.getX(k), normals.getY(k), normals.getZ(k)).dot(dir)).toBeCloseTo(1, 5)
    }
  })

  it('нормаль каждой вершины — радиальное направление тела (инвариант vEast шейдера)', () => {
    // Потребитель: PlanetShaderTemplate.vEast = normalMatrix * cross(up, normal).
    // vEast опирается на радиальность normal — если бы normal вдруг перестала
    // совпадать с normalize(center + position_rel), TBN slope-шейдинга снова
    // сломался бы так же, как ломался на RTC-position (см. HeightNormal.spec)
    const field = bumpyField()
    const { geometry, center } = build(field, 3, 1, 0)
    const pos = geometry.getAttribute('position')
    const normals = geometry.getAttribute('normal')

    for (let k = 0; k < pos.count; k++) {
      const absolute = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).add(center)
      const expectedNormal = absolute.clone().normalize()
      const actualNormal = new Vector3(normals.getX(k), normals.getY(k), normals.getZ(k))
      expect(actualNormal.x).toBeCloseTo(expectedNormal.x, 6)
      expect(actualNormal.y).toBeCloseTo(expectedNormal.y, 6)
      expect(actualNormal.z).toBeCloseTo(expectedNormal.z, 6)
    }
  })

  it('RTC: относительные позиции малы против радиуса, bounding-сфера конечна', () => {
    const field = bumpyField()
    const { geometry } = build(field, 2, 0, 1)
    const pos = geometry.getAttribute('position')

    let maxLen = 0
    for (let k = 0; k < pos.count; k++) {
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
    const topY = buildTerrainPatchGeometry(field, 2, 0, 0, 0, SEGMENTS, index) // +Y, t=+1 — общее ребро с −Z
    const backZ = buildTerrainPatchGeometry(field, 5, 0, 0, 0, SEGMENTS, index) // −Z, t=+1 — общее ребро с +Y
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

describe('buildTerrainPatchGeometry: UV', () => {
  it('патч вдали от шва: uv == dirToUv и в [0,1]', () => {
    const field = bumpyField()
    // +X-грань: u в районе 0.75, шов (u=0) не задевает
    const { geometry, center } = build(field, 0, 0, 0)
    const pos = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    const scratch = new Vector2()

    for (let k = 0; k < pos.count; k++) {
      const dir = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).add(center).normalize()
      field.dirToUv(dir, scratch)
      // dir восстановлен из float32-позиции — тот же квантовый шум, что и выше, сверка до 1e-6 вместо побитовой
      expect(uv.getX(k)).toBeCloseTo(scratch.x, 6)
      // v атрибута — флип v карты: dirToUv.y=0 на севере (строка 0 карты),
      // загрузчик текстур флипует изображение (север = v 1, как у нативной
      // SphereGeometry) — атрибут сейчас мёртв для рендера (фрагмент считает
      // uv сам), но зеркальный атрибут был бы миной для будущего потребителя
      expect(uv.getY(k)).toBeCloseTo(1 - scratch.y, 6)
      expect(uv.getX(k)).toBeGreaterThanOrEqual(0)
      expect(uv.getX(k)).toBeLessThanOrEqual(1)
    }
  })

  it('шовный патч: u непрерывен внутри патча (разброс < 0.5), может выйти за [0,1], и по модулю 1 совпадает с dirToUv', () => {
    const field = bumpyField()
    // −X-грань содержит меридиан u=0/1 (dir=(−1,0,0) → phi=0)
    const { geometry, center } = build(field, 1, 0, 0)
    const pos = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    const scratch = new Vector2()

    let min = Infinity
    let max = -Infinity
    for (let k = 0; k < uv.count; k++) {
      min = Math.min(min, uv.getX(k))
      max = Math.max(max, uv.getX(k))

      // развёртка допускает выход за [0,1] (шов раскрыт непрерывно), но не
      // меняет физический меридиан — остаток по модулю 1 обязан совпасть с
      // dirToUv с f32-точностью, а не просто "разброс небольшой"
      const dir = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).add(center).normalize()
      field.dirToUv(dir, scratch)
      const wrapped = uv.getX(k) - Math.floor(uv.getX(k))
      const delta = Math.abs(wrapped - scratch.x)
      expect(Math.min(delta, 1 - delta)).toBeLessThan(1e-6)
    }
    expect(max - min).toBeLessThan(0.5)
  })

  it('вершина ровно в полюсе: v ровно 0/1, u — центра патча', () => {
    const field = bumpyField()
    // +Y-грань, глубина 1: патч (1,1) касается полюса углом (s=0,t=0)
    const { geometry, center } = build(field, 2, 1, 1)
    const pos = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')

    let found = 0
    for (let k = 0; k < pos.count; k++) {
      const dir = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).add(center).normalize()
      if (Math.abs(dir.y) < 1 - 1e-9) continue
      found++
      // dirToUv.y = 0 на севере (картная конвенция), атрибут — флип
      // картного (см. тест выше) → север ровно 1, как у нативной SphereGeometry
      expect(uv.getY(k)).toBe(1) // север
      // u полюса = u параметрического центра патча
      const centerDir = center.clone().normalize()
      const centerUv = field.dirToUv(centerDir, new Vector2())
      expect(Math.abs(uv.getX(k) - centerUv.x)).toBeLessThan(0.51)
    }
    expect(found).toBe(1)
  })

  it('страж конвенции: северное полушарие (dir.y > 0) — вершинный uv.y > 0.5 (север — верх текстуры)', () => {
    // однострочный тест, который поймал бы зеркало С-Ю с самого начала:
    // текстурное v растёт от юга (0) к северу (1), как у нативных uv старой сферы
    const field = bumpyField()
    const { geometry, center } = build(field, 2, 0, 0) // +Y-грань — вся в северном полушарии
    const pos = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')

    for (let k = 0; k < pos.count; k++) {
      const dir = new Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).add(center).normalize()
      if (dir.y <= 0) continue
      expect(uv.getY(k)).toBeGreaterThan(0.5)
    }
  })
})
