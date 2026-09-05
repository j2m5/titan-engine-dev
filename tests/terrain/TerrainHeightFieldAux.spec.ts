import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { constantHeightField } from '@/core/terrain/constantHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { parseTerrainAux } from '@/core/terrain/terrainAuxFormat'
import { TERRAIN_QUADTREE_MAX_LEVEL, TERRAIN_QUADTREE_MIN_LEVEL } from '@/core/terrain/terrainQuadtreeSelect'
import { CUBE_FACES } from '@/core/terrain/cubeSphere'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { encodeTerrainAux } from '../../scripts/lib/terrainAuxEncode'

const RADIUS_KM = 1737.4
// полоса выключена там, где тест пинит ε КАРТЫ напрямую (см. конвенцию TerrainHeightField.spec.ts)
const MIDBAND_OFF = { ...MIDBAND_DEFAULTS, midbandStrength: 0 }

/** Карта с настоящей структурой: кинки на каждом текселе, чтобы провис и максимумы узлов не были константой. */
function texturedMap(width: number = 256, height: number = 128): HeightMapData {
  const data = new Uint16Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ridge = Math.sin(x * 0.35) * Math.cos(y * 0.51) + 0.4 * Math.sin(x * 1.7 + y * 0.9)
      data[y * width + x] = Math.round(32768 + 22000 * Math.max(-1, Math.min(1, ridge)))
    }
  }

  return { width, height, minMeters: -9150, maxMeters: 10777, data }
}

function directions(count: number = 64): Vector3[] {
  const out: Vector3[] = []

  for (let i = 0; i < count; i++) {
    // золотая спираль: покрытие обоих полушарий, включая приполярные широты
    const y = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const phi = i * 2.399963229728653
    out.push(new Vector3(r * Math.cos(phi), y, r * Math.sin(phi)).normalize())
  }

  return out
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function expectSameField(baked: TerrainHeightField, computed: TerrainHeightField): void {
  expect(baked.maxClearanceMeters).toBe(computed.maxClearanceMeters)
  expect(baked.maxSagMeters).toBe(computed.maxSagMeters)
  expect(baked.equatorTexelMeters).toBe(computed.equatorTexelMeters)

  for (let level = TERRAIN_QUADTREE_MIN_LEVEL; level <= TERRAIN_QUADTREE_MAX_LEVEL; level++) {
    expect(baked.geometricErrorMeters(level)).toBe(computed.geometricErrorMeters(level))
  }

  for (const dir of directions()) {
    expect(baked.clearanceMeters(dir)).toBe(computed.clearanceMeters(dir))
    expect(baked.heightMeters(dir)).toBe(computed.heightMeters(dir))
    expect(baked.sagMeters(dir)).toBe(computed.sagMeters(dir))
  }

  for (let face = 0; face < CUBE_FACES; face++) {
    for (const level of [TERRAIN_QUADTREE_MIN_LEVEL, 4, TERRAIN_QUADTREE_MAX_LEVEL]) {
      const patches = 2 ** level
      for (const [i, j] of [
        [0, 0],
        [patches - 1, patches - 1],
        [patches >> 1, patches >> 2]
      ]) {
        expect(baked.nodeMaxHeightMeters(face, level, i, j)).toBe(computed.nodeMaxHeightMeters(face, level, i, j))
      }
    }
  }
}

describe('TerrainHeightField: запечённые блоки вместо счёта в конструкторе', () => {
  it('поле, собранное из собственного exportAux, ведёт себя тождественно посчитанному', () => {
    const map = texturedMap()
    const computed = new TerrainHeightField(map, RADIUS_KM)

    const baked = new TerrainHeightField({ ...map, aux: computed.exportAux() }, RADIUS_KM)

    expectSameField(baked, computed)
  })

  it('тождественность переживает round-trip через файл компаньона', () => {
    const map = texturedMap()
    const computed = new TerrainHeightField(map, RADIUS_KM)
    const parsed = parseTerrainAux(toArrayBuffer(encodeTerrainAux(computed.exportAux(), map)))

    const baked = new TerrainHeightField({ ...map, aux: parsed }, RADIUS_KM)

    expectSameField(baked, computed)
  })

  it('usedBakedAux честно различает два пути сборки', () => {
    const map = texturedMap()
    const computed = new TerrainHeightField(map, RADIUS_KM)

    expect(computed.usedBakedAux).toBe(false)
    expect(new TerrainHeightField({ ...map, aux: computed.exportAux() }, RADIUS_KM).usedBakedAux).toBe(true)
  })

  it('блоки берутся ИЗ компаньона, а не пересчитываются заново', () => {
    // подложный компаньон: сетка провиса заполнена меткой, которой карта дать
    // не может. Совпадение с меткой доказывает, что тяжёлый проход не
    // выполнялся — тайминг для этого был бы плавающим суррогатом.
    const map = texturedMap()
    const aux = new TerrainHeightField(map, RADIUS_KM).exportAux()
    aux.clearanceGrid.fill(4242)

    const baked = new TerrainHeightField({ ...map, aux }, RADIUS_KM)

    for (const dir of directions(16)) expect(baked.clearanceMeters(dir)).toBeCloseTo(4242, 6)
  })

  it('ε-пирамида уровней тоже приходит из компаньона, а не считается', () => {
    // полоса выключена: тест пинит ε КАРТЫ из компаньона напрямую — с полосой
    // по умолчанию geometricErrorMeters домешал бы ещё и её добавку (Task 5)
    const map = texturedMap()
    const aux = new TerrainHeightField(map, RADIUS_KM, MIDBAND_OFF).exportAux()
    aux.levelErrorMeters.fill(777)

    expect(new TerrainHeightField({ ...map, aux }, RADIUS_KM, MIDBAND_OFF).geometricErrorMeters(3)).toBe(777)
  })

  it('запечённые блоки не зависят от радиуса тела — на этом стоит запечка пер-КАРТУ, а не пер-тело', () => {
    // Страж допущения, на котором держится и формат компаньона (радиуса в нём
    // нет), и офлайн-скрипт (строит поле с условным радиусом), и кеш
    // terrainHeightFieldFor. Появись в блоках хоть одна радиусозависимая
    // величина — запечка молча раздала бы одному телу числа другого.
    const map = texturedMap()
    const moon = new TerrainHeightField(map, RADIUS_KM).exportAux()
    const earth = new TerrainHeightField(map, 6371).exportAux()

    expect(earth.maxClearanceMeters).toBe(moon.maxClearanceMeters)
    expect(earth.maxSagMeters).toBe(moon.maxSagMeters)
    expect(Array.from(earth.clearanceGrid)).toEqual(Array.from(moon.clearanceGrid))
    expect(Array.from(earth.levelErrorMeters)).toEqual(Array.from(moon.levelErrorMeters))
    expect(Array.from(earth.nodeMaxHeightMetersPyramid!)).toEqual(Array.from(moon.nodeMaxHeightMetersPyramid!))
  })

  it('константное поле: пирамиды максимумов нет ни до, ни после запечки', () => {
    const water = constantHeightField(RADIUS_KM, -667.2)

    const aux = water.exportAux()

    expect(aux.nodeMaxHeightMetersPyramid).toBeNull()
    expect(water.nodeMaxHeightMeters(0, TERRAIN_QUADTREE_MAX_LEVEL, 0, 0)).toBe(-667.2)
  })
})
