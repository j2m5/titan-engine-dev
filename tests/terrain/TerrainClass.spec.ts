import { RenderingObjects } from '@storage/database'
import type { IRenderingObject } from '@/core/models/types'
import { Actor } from '@/core/models/Actor'
import { TERRAIN_CLASSES, terrainArchetypeOf, terrainClassOf, type TerrainClass } from '@/core/terrain/terrainClass'

const terraformed = (): Actor[] =>
  RenderingObjects.filter((row: IRenderingObject) => (row.data as { macroStrength?: number } | undefined)?.macroStrength === 0.25)
    .map((row: IRenderingObject) => Actor.find(row.actorId)!)

describe('terrainArchetypeOf', () => {
  it('точный путь набора → архетип; прочее → null', () => {
    expect(terrainArchetypeOf('terrain/rocky_trail_diff.webp')).toBe('rocky')
    expect(terrainArchetypeOf('terrain/ice_diff.webp')).toBe('ice')
    expect(terrainArchetypeOf('terrain/sand_diff.webp')).toBe('sand')
    expect(terrainArchetypeOf('terrain/volcanic_diff.webp')).toBe('volcanic')
    expect(terrainArchetypeOf('asteroids/rock_boulder_dry_diff_2k.jpg')).toBeNull()
    expect(terrainArchetypeOf(undefined)).toBeNull()
  })
})

describe('terrainClassOf', () => {
  it('8 классов', () => {
    expect([...TERRAIN_CLASSES].sort()).toEqual(
      ['ice-airless', 'ice-atmosphere', 'rocky-airless', 'rocky-atmosphere', 'sand-airless', 'sand-atmosphere', 'volcanic-airless', 'volcanic-atmosphere'].sort()
    )
  })

  it('распределение 54 терраформных тел', () => {
    const bodies = terraformed()
    expect(bodies).toHaveLength(54)
    const counts = new Map<TerrainClass | null, number>()
    for (const body of bodies) {
      const cls = terrainClassOf(body)
      counts.set(cls, (counts.get(cls) ?? 0) + 1)
    }
    expect(Object.fromEntries(counts)).toEqual({
      // +4 (Task 4, система W26 — Emberon, Halcyra I/II, Nivalis): общий
      // детальный набор rocky_trail. Nivalis (Task 6) получила атмосферу —
      // rocky-airless минус один, rocky-atmosphere плюс один.
      'rocky-airless': 19, 'rocky-atmosphere': 5, 'ice-airless': 23, 'sand-atmosphere': 3,
      'sand-airless': 2, 'volcanic-atmosphere': 1, 'volcanic-airless': 1
    })
  })

  it('опорные тела', () => {
    expect(terrainClassOf(Actor.find(19)!)).toBe('rocky-airless')     // Луна
    expect(terrainClassOf(Actor.find(7)!)).toBe('rocky-atmosphere')   // Земля
    expect(terrainClassOf(Actor.find(21)!)).toBe('ice-airless')       // Европа
    expect(terrainClassOf(Actor.find(8)!)).toBe('sand-atmosphere')    // Марс
    expect(terrainClassOf(Actor.find(66)!)).toBe('sand-airless')      // Гуэрмесса
    expect(terrainClassOf(Actor.find(6)!)).toBe('volcanic-atmosphere')// Венера
    expect(terrainClassOf(Actor.find(20)!)).toBe('volcanic-airless')  // Ио
  })

  it('тело без детали (Юпитер, 10) — null', () => {
    expect(terrainClassOf(Actor.find(10)!)).toBeNull()
  })
})
