import type { ShaderMaterial } from 'three'
import { Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import type { IPlanetRenderingObject } from '@/core/models/types'
import { readRenderingData } from '@/core/helpers/renderingData'
import { proceduralDiffuseKey } from '@/core/services/ProceduralSurfaceGenerator'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'

/**
 * Сбор состояний материала планет для теста паритета: снимок старого
 * материала и сверка нового с ним идут через одну и ту же функцию.
 */

export type ParityPath = 'sphere' | 'terrain'
export type ParityStateName = 'sphere-bare' | 'sphere-full' | 'terrain-bare' | 'terrain-full'

/** undefined и null у юниформа различимы: JSON undefined теряет, поэтому маркер. */
export type SerializedUniform = number | boolean | string | null | number[] | { texture: string } | { undefined: true }

export interface ParityState {
  actorId: number
  state: ParityStateName
  path: ParityPath
  defines: Record<string, string | number | boolean>
  uniforms: Record<string, SerializedUniform>
}

export type ParityMaterial = ShaderMaterial & { updateMaterial(): void }

const PLANET_CATEGORY_ID = 4
const RING_CATEGORY_ID = 6

// -0 после JSON становится 0, а toEqual их различает
const plainNumber = (x: number, key: string): number => {
  if (!Number.isFinite(x)) throw new Error(`serializeUniforms: ${key} — неконечное число ${x}`)

  return x === 0 ? 0 : x
}

const hasToArray = (v: unknown): v is { toArray(): number[] } =>
  typeof v === 'object' && v !== null && typeof (v as { toArray?: unknown }).toArray === 'function'

function serializeValue(value: unknown, key: string): SerializedUniform {
  if (value === null) return null
  if (value === undefined) return { undefined: true }
  if (value instanceof Texture) return { texture: value.name }
  if (hasToArray(value)) return value.toArray().map((x) => plainNumber(x, key))
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, i: number): number[] => {
      if (typeof item === 'number') return [plainNumber(item, `${key}[${i}]`)]
      if (hasToArray(item)) return item.toArray().map((x) => plainNumber(x, `${key}[${i}]`))
      throw new Error(`serializeUniforms: ${key}[${i}] — неизвестный тип элемента`)
    })
  }
  if (typeof value === 'number') return plainNumber(value, key)
  if (typeof value === 'boolean' || typeof value === 'string') return value

  throw new Error(`serializeUniforms: ${key} — неизвестный тип значения`)
}

/** Сравнимая форма юниформов; неизвестный тип — ошибка с именем ключа. */
export function serializeUniforms(uniforms: Record<string, { value: unknown }>): Record<string, SerializedUniform> {
  const out: Record<string, SerializedUniform> = {}
  for (const key of Object.keys(uniforms).sort()) out[key] = serializeValue(uniforms[key].value, key)

  return out
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// содержимое не важно: материал спрашивает только факт наличия карты в реестре
function seedHeightMap(path: string): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(path, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

function resetRegistries(): void {
  resourceStorage.deleteAllTextures()
  heightFieldStorage.clear()
}

const pathsOf = (actor: Actor): string[] =>
  actor.resources
    .all()
    .map((r) => r.getAttribute('path'))
    .filter((p): p is string => typeof p === 'string')

const ringsOf = (actor: Actor): Actor[] => actor.children.where('categoryId', RING_CATEGORY_ID).all()

/**
 * Ключи, по которым материал ходит через getTextureOrMake: промах строит
 * PlaceholderTexture на канвасе, которого в jsdom нет. Кольца — туда же
 * (текстура тени колец в конструкторе шейдера).
 */
function seedPlaceholderKeys(actor: Actor): void {
  const keys = new Set<string>(['', 'default.png', 'night.jpg'])
  const diffuse = actor.resources.where('resourceType', 'diffuse').first()?.getAttribute('path')
  if (typeof diffuse === 'string') keys.add(diffuse)
  if (readRenderingData<IPlanetRenderingObject>(actor)?.proceduralSurface) {
    keys.add(proceduralDiffuseKey(actor.getAttribute('id', -1)))
  }
  for (const ring of ringsOf(actor)) {
    const ringPath = ring.resources.first()?.getAttribute('path')
    if (typeof ringPath === 'string') keys.add(ringPath)
  }
  for (const key of keys) seedTexture(key)
}

function seedFull(actor: Actor, withSteep: boolean): void {
  const keys = new Set<string>([...pathsOf(actor), ...ringsOf(actor).flatMap(pathsOf)])
  if (withSteep) for (const p of Object.values(STEEP_DETAIL_PATHS)) keys.add(p)
  for (const key of keys) if (!resourceStorage.isExistsTexture(key)) seedTexture(key)
}

/** Все тела категории 4 по возрастанию id: sphere-bare/full у всех, terrain-* у тел с height-ресурсом. */
export function collectParityStates(makeMaterial: (actor: Actor, path: ParityPath) => ParityMaterial): ParityState[] {
  const actors = Actor.where({ categoryId: PLANET_CATEGORY_ID })
    .all()
    .sort((a, b) => (a.getAttribute('id') as number) - (b.getAttribute('id') as number))
  const states: ParityState[] = []

  const capture = (actor: Actor, state: ParityStateName, path: ParityPath, seed: () => void): void => {
    resetRegistries()
    seed()
    try {
      const material = makeMaterial(actor, path)
      material.updateMaterial()
      states.push({
        actorId: actor.getAttribute('id') as number,
        state,
        path,
        defines: { ...(material.defines as Record<string, string | number | boolean>) },
        uniforms: serializeUniforms(material.uniforms)
      })
      material.dispose()
    } finally {
      resetRegistries()
    }
  }

  for (const actor of actors) {
    const heightPath = heightPathOf(actor)

    capture(actor, 'sphere-bare', 'sphere', () => seedPlaceholderKeys(actor))
    capture(actor, 'sphere-full', 'sphere', () => {
      seedPlaceholderKeys(actor)
      seedFull(actor, false)
    })

    if (heightPath === undefined) continue

    capture(actor, 'terrain-bare', 'terrain', () => {
      seedPlaceholderKeys(actor)
      seedHeightMap(heightPath)
    })
    capture(actor, 'terrain-full', 'terrain', () => {
      seedPlaceholderKeys(actor)
      seedHeightMap(heightPath)
      seedFull(actor, true)
    })
  }

  return states
}
