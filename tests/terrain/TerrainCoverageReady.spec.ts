import { describe, it, expect } from 'vitest'
import {
  coverageReady,
  terrainNodeKey,
  TERRAIN_QUADTREE_MAX_LEVEL,
  type TerrainNodeAddress
} from '@/core/terrain/terrainQuadtreeSelect'

/**
 * Эквивалентность быстрого `coverageReady` (обход предков/потомков по битовой
 * арифметике адреса) эталонному брутфорсу — дословному порту прежних двух
 * сканов `wanted` из TerrainPatchGroup (O(|live|×|wanted|), из-за которых
 * ревью 2026-08-17 намерило 74 880 итераций/кадр).
 *
 * Домен эквивалентности — НАСТОЯЩИЕ тайлинги: selectTerrainNodes всегда
 * возвращает полное разбиение всех шести граней (лист на каждой ветке),
 * поэтому генератор строит корректные разбиения, а не произвольные наборы.
 */

/** Дословный порт прежней реализации из TerrainPatchGroup (до оптимизации). */
function coverageReadyReference(
  x: TerrainNodeAddress,
  wanted: ReadonlyMap<number, TerrainNodeAddress>,
  isLive: (key: number) => boolean
): boolean {
  let hasDescendant = false

  for (const y of wanted.values()) {
    if (y.face !== x.face || y.level <= x.level) continue

    const delta = y.level - x.level
    if (y.i >> delta === x.i && y.j >> delta === x.j) {
      hasDescendant = true
      if (!isLive(terrainNodeKey(y))) return false
    }
  }
  if (hasDescendant) return true

  for (const y of wanted.values()) {
    if (y.face !== x.face || y.level >= x.level) continue

    const delta = x.level - y.level
    if (x.i >> delta === y.i && x.j >> delta === y.j) {
      return isLive(terrainNodeKey(y))
    }
  }

  return false
}

/** Детерминированный PRNG (mulberry32) — Math.random в тестах недопустим: провал должен воспроизводиться. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Случайное корректное разбиение грани: лист либо четыре ребёнка, глубина ≤ maxLevel. */
function buildTiling(
  rand: () => number,
  face: number,
  maxLevel: number,
  splitChance: number
): Map<number, TerrainNodeAddress> {
  const wanted = new Map<number, TerrainNodeAddress>()

  const visit = (level: number, i: number, j: number): void => {
    if (level < maxLevel && rand() < splitChance) {
      for (let di = 0; di < 2; di++) {
        for (let dj = 0; dj < 2; dj++) {
          visit(level + 1, i * 2 + di, j * 2 + dj)
        }
      }
      return
    }
    const address: TerrainNodeAddress = { face, level, i, j }
    wanted.set(terrainNodeKey(address), address)
  }

  for (let di = 0; di < 2; di++) {
    for (let dj = 0; dj < 2; dj++) {
      visit(1, di, dj)
    }
  }

  return wanted
}

describe('coverageReady: быстрый обход эквивалентен эталонному скану wanted', () => {
  it('спуск в процессе: не все желаемые листья внутри x живые — false, все живые — true', () => {
    const x: TerrainNodeAddress = { face: 2, level: 2, i: 1, j: 1 }
    const children: TerrainNodeAddress[] = [
      { face: 2, level: 3, i: 2, j: 2 },
      { face: 2, level: 3, i: 3, j: 2 },
      { face: 2, level: 3, i: 2, j: 3 },
      { face: 2, level: 3, i: 3, j: 3 }
    ]
    const wanted = new Map(children.map((a) => [terrainNodeKey(a), a]))

    const partial = new Set(children.slice(0, 3).map(terrainNodeKey))
    expect(coverageReady(x, wanted, (k) => partial.has(k))).toBe(false)

    const full = new Set(children.map(terrainNodeKey))
    expect(coverageReady(x, wanted, (k) => full.has(k))).toBe(true)
  })

  it('схлопывание: желаемый предок построен — true, не построен — false', () => {
    const x: TerrainNodeAddress = { face: 0, level: 3, i: 5, j: 2 }
    const ancestor: TerrainNodeAddress = { face: 0, level: 1, i: 1, j: 0 }
    const wanted = new Map([[terrainNodeKey(ancestor), ancestor]])

    expect(coverageReady(x, wanted, (k) => k === terrainNodeKey(ancestor))).toBe(true)
    expect(coverageReady(x, wanted, () => false)).toBe(false)
  })

  it('чужая грань/несвязанный узел: связи нет — пин (false)', () => {
    const x: TerrainNodeAddress = { face: 1, level: 2, i: 0, j: 0 }
    const stranger: TerrainNodeAddress = { face: 4, level: 2, i: 0, j: 0 }
    const wanted = new Map([[terrainNodeKey(stranger), stranger]])

    expect(coverageReady(x, wanted, () => true)).toBe(false)
  })

  it('property: 300 случайных (тайлинг, live, x) — бит-в-бит с эталоном', () => {
    const rand = mulberry32(0x7e44a1)

    for (let round = 0; round < 300; round++) {
      const face = Math.floor(rand() * 6)
      const maxLevel = 2 + Math.floor(rand() * Math.min(3, TERRAIN_QUADTREE_MAX_LEVEL - 2))
      const wanted = buildTiling(rand, face, maxLevel, 0.55)

      // live — случайное подмножество wanted плюс случайные предки: реальный
      // live между кадрами содержит и уходящие крупные узлы.
      const live = new Set<number>()
      for (const [key, a] of wanted) {
        if (rand() < 0.7) live.add(key)
        if (a.level > 1 && rand() < 0.3) {
          const up = 1 + Math.floor(rand() * (a.level - 1))
          live.add(terrainNodeKey({ face, level: a.level - up, i: a.i >> up, j: a.j >> up }))
        }
      }

      // x — случайный узел дерева этой грани (не обязательно из wanted)
      const xLevel = 1 + Math.floor(rand() * maxLevel)
      const x: TerrainNodeAddress = {
        face,
        level: xLevel,
        i: Math.floor(rand() * 2 ** xLevel),
        j: Math.floor(rand() * 2 ** xLevel)
      }

      const isLive = (k: number): boolean => live.has(k)
      const fast = coverageReady(x, wanted, isLive)
      const reference = coverageReadyReference(x, wanted, isLive)

      expect(fast, `round ${round}: x=${JSON.stringify(x)}`).toBe(reference)
    }
  })
})
