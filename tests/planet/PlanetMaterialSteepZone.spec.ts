import { afterEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { ResourceType } from '@/core/models/types'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'

function seedTexture(name: string, width: number = 4, height: number = 2): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width, height }
  resourceStorage.addTexture(texture)
}

/**
 * Конструктор PlanetShader ходит через getTextureOrMake за 'default.png',
 * 'night.jpg' и '' (заглушка кольца) — промах строит PlaceholderTexture на
 * канвасе, которого в jsdom нет (тот же приём, что в остальных PlanetMaterial-спеках).
 */
function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) seedTexture(name)
}

function seedSteepTextures(): void {
  seedTexture(STEEP_DETAIL_PATHS.diffuse)
  seedTexture(STEEP_DETAIL_PATHS.normal)
  seedTexture(STEEP_DETAIL_PATHS.arm)
}

// Энцелад (actorId 25) — ледяное тело, родной набор detailDiffuse = ice_diff (не steep)
function enceladus(): Actor {
  return Actor.find(25)!
}

// Луна (actorId 19) — родной набор detailDiffuse УЖЕ rocky_trail (сам steep-набор)
function moon(): Actor {
  return Actor.find(19)!
}

function pathOf(actor: Actor, kind: ResourceType): string {
  return actor.resources.where('resourceType', kind).first()!.getAttribute('path') as string
}

/**
 * Стаб-актор с невалидными ручками steep-зон (steepFull <= steepStart) —
 * образец stubActor других PlanetMaterial-спеков (PlanetMaterialProcedural.spec.ts,
 * PlanetCavity.spec.ts): подменяем геттеры-связи плоским объектом.
 */
function stubActorWithInvalidSteepHandles(): Actor {
  return {
    getAttribute: (key: string, fallback?: unknown): unknown => {
      if (key === 'id') return 999
      if (key === 'name') return 'Stub Invalid Steep'
      return fallback
    },
    renderingObject: {
      getAttribute: (key: string): unknown =>
        key === 'data' ? { emission: 1, steepStart: 0.6, steepFull: 0.5 } : undefined
    },
    physicalObject: { getAttribute: (key: string): unknown => (key === 'radius' ? 1000 : undefined) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: {
      where: () => ({ first: () => undefined })
    }
  } as unknown as Actor
}

describe('PlanetMaterial: steep-зоны материала (гейт и юниформы, Task 3)', () => {
  afterEach(() => resourceStorage.deleteAllTextures())

  it('гейт=1 у Энцелада при всех трёх steep-текстурах в resourceStorage — маска дефолтная', () => {
    seedPlaceholderKeys()
    seedTexture(pathOf(enceladus(), 'diffuse'))
    seedSteepTextures()

    const material = new PlanetMaterial(enceladus())
    material.updateMaterial()

    expect(material.uniforms.uSteepGate.value).toBe(1)
    expect((material.uniforms.uSteepMask.value as { x: number; y: number; z: number }).x).toBeCloseTo(0.35)
    expect((material.uniforms.uSteepMask.value as { x: number; y: number; z: number }).y).toBeCloseTo(0.55)
    expect((material.uniforms.uSteepMask.value as { x: number; y: number; z: number }).z).toBeCloseTo(0.15)
  })

  it('гейт=0 у Луны — родной detailDiffuse уже сам steep-набор (rocky_trail)', () => {
    seedPlaceholderKeys()
    seedTexture(pathOf(moon(), 'diffuse'))
    seedSteepTextures()

    const material = new PlanetMaterial(moon())
    material.updateMaterial()

    expect(material.uniforms.uSteepGate.value).toBe(0)
  })

  it('без одной из трёх steep-текстур у Энцелада — гейт 0', () => {
    seedPlaceholderKeys()
    seedTexture(pathOf(enceladus(), 'diffuse'))
    seedTexture(STEEP_DETAIL_PATHS.diffuse)
    seedTexture(STEEP_DETAIL_PATHS.normal)
    // STEEP_DETAIL_PATHS.arm намеренно не сеется — набор неполный

    const material = new PlanetMaterial(enceladus())
    material.updateMaterial()

    expect(material.uniforms.uSteepGate.value).toBe(0)
  })

  it('невалидные ручки (steepFull <= steepStart) — updateMaterial бросает громко, с полем steepFull', () => {
    seedPlaceholderKeys()

    const material = new PlanetMaterial(stubActorWithInvalidSteepHandles())

    expect(() => material.updateMaterial()).toThrow(/steepFull/)
  })

  it('resetMaterial обнуляет гейт и сэмплеры steep-зоны', () => {
    seedPlaceholderKeys()
    seedTexture(pathOf(enceladus(), 'diffuse'))
    seedSteepTextures()

    const material = new PlanetMaterial(enceladus())
    material.updateMaterial()
    expect(material.uniforms.uSteepGate.value).toBe(1)

    material.resetMaterial()

    expect(material.uniforms.uSteepGate.value).toBe(0)
    expect(material.uniforms.uSteepNorMap.value).toBeNull()
    expect(material.uniforms.uSteepArmMap.value).toBeNull()
    expect(material.uniforms.uSteepDiffMap.value).toBeNull()
  })
})
