import { describe, expect, it } from 'vitest'
import { Actor } from '@/core/models/Actor'
import { terrainClassOf } from '@/core/terrain/terrainClass'
import { terrainDataOf } from '@/core/terrain/terrainClassPresets'
import { midbandParamsOf } from '@/core/terrain/midbandParams'
import { heightPathOf } from '@/core/terrain/heightPath'

const bodies = Actor.all()
  .filter((actor) => heightPathOf(actor) !== undefined)
  .all()
const rocky = bodies.filter((actor) => /^(rocky|sand|volcanic)-/.test(terrainClassOf(actor) ?? ''))

describe('rocky terrain rollout', () => {
  it('enables shelves, weathering and boulders for the complete rocky catalog', () => {
    expect(rocky).toHaveLength(36)
    for (const body of rocky) {
      const name = body.getAttribute('name'),
        data = terrainDataOf(body),
        field = midbandParamsOf(body)
      expect(data.boulderDensity, name).toBeGreaterThan(0)
      expect(data.boulderDensity, name).toBeLessThanOrEqual(1)
      expect(field.bedrockStrength, name).toBeGreaterThan(0)
      expect(field.bedrockWeathering, name).toBeGreaterThan(0)
      expect(field.bedrockStepMeters, name).toBeGreaterThanOrEqual(80)
      expect(field.bedrockStepMeters, name).toBeLessThanOrEqual(800)
    }
  })

  it('keeps the accepted Mars profile and scales strata down on small moons', () => {
    expect(terrainDataOf(Actor.find(8)!)).toMatchObject({
      bedrockStrength: 0.45,
      bedrockStepMeters: 800,
      bedrockWeathering: 1,
      boulderDensity: 1
    })
    const small = midbandParamsOf(Actor.find(99)!),
      moon = midbandParamsOf(Actor.find(19)!),
      earth = midbandParamsOf(Actor.find(7)!)
    expect(small.bedrockStepMeters).toBeLessThan(moon.bedrockStepMeters)
    expect(moon.bedrockStepMeters).toBeLessThan(earth.bedrockStepMeters)
    expect(terrainDataOf(Actor.find(20)!).bedrockStrength).not.toBe(terrainDataOf(Actor.find(19)!).bedrockStrength)
  })

  it('leaves the complete ice catalog and gas giants outside this rollout', () => {
    const excluded = Actor.all()
      .filter(
        (actor) => terrainClassOf(actor)?.startsWith('ice-') || [10, 11, 12, 13].includes(actor.getAttribute('id')!)
      )
      .all()
    expect(excluded).toHaveLength(35)
    for (const body of excluded) {
      expect(terrainDataOf(body).boulderDensity ?? 0, body.getAttribute('name')).toBe(0)
      expect(midbandParamsOf(body).bedrockStrength, body.getAttribute('name')).toBe(0)
    }
  })

  it('honors explicit zeroes and terrainClass:none without modifying stored data', () => {
    const raw = {
      emission: 1,
      terrainClass: 'rocky-airless',
      bedrockStrength: 0,
      bedrockWeathering: 0,
      boulderDensity: 0,
      bedrockStepMeters: 123
    }
    const body = {
      renderingObject: { getAttribute: () => raw },
      physicalObject: { getAttribute: () => 175 },
      getAttribute: () => 'custom'
    } as unknown as Actor
    expect(terrainDataOf(body)).toMatchObject(raw)
    expect(Object.keys(raw)).toHaveLength(6)
    raw.terrainClass = 'none'
    expect(terrainDataOf(body)).toBe(raw)
  })
})
