import type { ShaderMaterial } from 'three'
import { Object3D, Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import type { IPlanetRenderingObject } from '@/core/models/types'
import { readRenderingData } from '@/core/helpers/renderingData'
import type { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
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
export type ParityStateName =
  | 'sphere-bare'
  | 'sphere-full'
  | 'sphere-full-tint'
  | 'terrain-bare'
  | 'terrain-full'
  | 'terrain-full-tint'

/** undefined и null у юниформа различимы: JSON undefined теряет, поэтому маркер. */
export type SerializedUniform = number | boolean | string | null | number[] | { texture: string } | { undefined: true }

/** Поле материала: примитивы, массивы и простые объекты (extensions, defaultAttributeValues). */
export type SerializedField =
  | number
  | boolean
  | string
  | null
  | { undefined: true }
  | SerializedField[]
  | { [key: string]: SerializedField }

export interface MaterialSnapshot {
  defines: Record<string, string | number | boolean>
  uniforms: Record<string, SerializedUniform>
  material: Record<string, SerializedField>
}

export interface ParityState extends MaterialSnapshot {
  actorId: number
  state: ParityStateName
  path: ParityPath
  /** То же после resetMaterial(). */
  reset: MaterialSnapshot
}

/** Состояние свежего сбора: плюс шейдер, как его держит материал (в снимок не пишется). */
export interface CollectedState extends ParityState {
  shader: { vertexShader: string; fragmentShader: string }
}

export type ParityMaterial = ShaderMaterial & {
  updateMaterial(): void
  resetMaterial(): void
  syncSunTint(): void
}

export type MakeParityMaterial = (actor: Actor, path: ParityPath, atmosphereRegistry: AtmosphereRegistry | undefined) => ParityMaterial

const PLANET_CATEGORY_ID = 4
const ATMOSPHERE_CATEGORY_ID = 5
const RING_CATEGORY_ID = 6

/** Поля ShaderMaterial/Material, которые сверяются (uuid, version и прочий счётчик — нет). */
export const MATERIAL_FIELDS = [
  'name',
  'type',
  'blending',
  'side',
  'shadowSide',
  'vertexColors',
  'opacity',
  'transparent',
  'alphaTest',
  'alphaHash',
  'blendSrc',
  'blendDst',
  'blendEquation',
  'blendSrcAlpha',
  'blendDstAlpha',
  'blendEquationAlpha',
  'blendColor',
  'blendAlpha',
  'depthFunc',
  'depthTest',
  'depthWrite',
  'stencilWrite',
  'colorWrite',
  'precision',
  'polygonOffset',
  'polygonOffsetFactor',
  'polygonOffsetUnits',
  'dithering',
  'alphaToCoverage',
  'premultipliedAlpha',
  'forceSinglePass',
  'visible',
  'toneMapped',
  'userData',
  'wireframe',
  'fog',
  'lights',
  'clipping',
  'extensions',
  'defaultAttributeValues',
  'index0AttributeName',
  'glslVersion',
  'uniformsGroups'
] as const

// -0 после JSON становится 0, а toStrictEqual их различает
const plainNumber = (x: number, key: string): number => {
  if (!Number.isFinite(x)) throw new Error(`serialize: ${key} — неконечное число ${x}`)

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

/** Сравнимая форма поля материала; неизвестный тип (функция, экземпляр класса) — ошибка с путём. */
export function serializeField(value: unknown, key: string): SerializedField {
  if (value === null) return null
  if (value === undefined) return { undefined: true }
  if (typeof value === 'number') return plainNumber(value, key)
  if (typeof value === 'boolean' || typeof value === 'string') return value
  if (hasToArray(value)) return value.toArray().map((x) => plainNumber(x, key))
  if (Array.isArray(value)) return value.map((item: unknown, i: number) => serializeField(item, `${key}[${i}]`))
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, SerializedField> = {}
    for (const k of Object.keys(value).sort()) out[k] = serializeField((value as Record<string, unknown>)[k], `${key}.${k}`)

    return out
  }

  throw new Error(`serializeField: ${key} — неизвестный тип значения`)
}

function snapshotOf(material: ParityMaterial): MaterialSnapshot {
  const fields: Record<string, SerializedField> = {}
  for (const field of MATERIAL_FIELDS) fields[field] = serializeField((material as unknown as Record<string, unknown>)[field], field)

  return {
    defines: { ...(material.defines as Record<string, string | number | boolean>) },
    uniforms: serializeUniforms(material.uniforms),
    material: fields
  }
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// содержимое не важно: материал спрашивает только факт наличия карты в реестре
export function seedHeightMap(path: string): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(path, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

export function resetRegistries(): void {
  resourceStorage.deleteAllTextures()
  heightFieldStorage.clear()
}

const pathsOf = (actor: Actor): string[] =>
  actor.resources
    .all()
    .map((r) => r.getAttribute('path'))
    .filter((p): p is string => typeof p === 'string')

const ringsOf = (actor: Actor): Actor[] => actor.children.where('categoryId', RING_CATEGORY_ID).all()

/** Ключ диффуза, как его спрашивает updateMaterial: процедурный, путь ресурса или ''. */
function diffuseKeyOf(actor: Actor): string {
  if (readRenderingData<IPlanetRenderingObject>(actor)?.proceduralSurface) return proceduralDiffuseKey(actor.getAttribute('id', -1))
  const path = actor.resources.where('resourceType', 'diffuse').first()?.getAttribute('path')

  return typeof path === 'string' ? path : ''
}

/**
 * Ключи, по которым материал ходит через getTextureOrMake: промах строит
 * PlaceholderTexture на канвасе, которого в jsdom нет. Кольца — туда же
 * (текстура тени колец в конструкторе шейдера).
 */
export function seedPlaceholderKeys(actor: Actor): void {
  const keys = new Set<string>(['', 'default.png', 'night.jpg', diffuseKeyOf(actor)])
  const diffuse = actor.resources.where('resourceType', 'diffuse').first()?.getAttribute('path')
  if (typeof diffuse === 'string') keys.add(diffuse)
  for (const ring of ringsOf(actor)) {
    const ringPath = ring.resources.first()?.getAttribute('path')
    if (typeof ringPath === 'string') keys.add(ringPath)
  }
  for (const key of keys) seedTexture(key)
}

export function seedFull(actor: Actor, withSteep: boolean): void {
  const keys = new Set<string>([...pathsOf(actor), ...ringsOf(actor).flatMap(pathsOf)])
  if (withSteep) for (const p of Object.values(STEEP_DETAIL_PATHS)) keys.add(p)
  for (const key of keys) if (!resourceStorage.isExistsTexture(key)) seedTexture(key)
}

function lutTexture(name: string): Texture {
  const texture = new Texture()
  texture.name = name

  return texture
}

/** Реестр-заглушка с записью дочерней атмосферы тела; undefined — атмосферы с данными нет. */
export function tintRegistryFor(actor: Actor): AtmosphereRegistry | undefined {
  const atmosphere = actor.children.where('categoryId', ATMOSPHERE_CATEGORY_ID).first()
  const config = atmosphere ? readRenderingData<AtmosphereConfig>(atmosphere) : undefined
  if (!atmosphere || !config) return undefined

  const actorId = atmosphere.getAttribute('id') as number
  const registry = new AtmosphereRegistry()
  registry.register({
    actorId,
    name: String(atmosphere.getAttribute('name', '?')),
    object: new Object3D(),
    config,
    lut: {
      transmittance: lutTexture(`lut/${actorId}/transmittance`),
      scattering: lutTexture(`lut/${actorId}/scattering`),
      irradiance: lutTexture(`lut/${actorId}/irradiance`)
    }
  })

  return registry
}

/**
 * Все тела категории 4 по возрастанию id: sphere-bare/full у всех, terrain-* у
 * тел с height-ресурсом, *-full-tint у тел с атмосферой. Порядок вызовов —
 * как в рантайме: updateMaterial, syncSunTint (кадр), снова updateMaterial
 * (догрузка карты при живом тинте); затем снимок, resetMaterial, снимок.
 */
export function collectParityStates(makeMaterial: MakeParityMaterial): CollectedState[] {
  const actors = Actor.where({ categoryId: PLANET_CATEGORY_ID })
    .all()
    .sort((a, b) => (a.getAttribute('id') as number) - (b.getAttribute('id') as number))
  const states: CollectedState[] = []

  const capture = (
    actor: Actor,
    state: ParityStateName,
    path: ParityPath,
    registry: AtmosphereRegistry | undefined,
    seed: () => void
  ): void => {
    resetRegistries()
    seed()
    try {
      const material = makeMaterial(actor, path, registry)
      // '' нужна только конструктору (кольца через `?? ''`): в рантайме под ''
      // в реестре ничего нет, иначе тело без ночной/облачной/specular-строки
      // нашло бы её как фантомную карту. Остаётся, лишь если это ключ диффуза.
      if (diffuseKeyOf(actor) !== '') resourceStorage.deleteTexture('')
      material.updateMaterial()
      material.syncSunTint()
      material.updateMaterial()
      const live = snapshotOf(material)
      const shader = { vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }
      material.resetMaterial()
      const reset = snapshotOf(material)
      states.push({ actorId: actor.getAttribute('id') as number, state, path, ...live, reset, shader })
      material.dispose()
    } finally {
      resetRegistries()
    }
  }

  for (const actor of actors) {
    const heightPath = heightPathOf(actor)
    const tint = tintRegistryFor(actor)
    const full = (): void => {
      seedPlaceholderKeys(actor)
      seedFull(actor, false)
    }
    const terrainFull = (): void => {
      seedPlaceholderKeys(actor)
      seedHeightMap(heightPath!)
      seedFull(actor, true)
    }

    capture(actor, 'sphere-bare', 'sphere', undefined, () => seedPlaceholderKeys(actor))
    capture(actor, 'sphere-full', 'sphere', undefined, full)
    if (tint) capture(actor, 'sphere-full-tint', 'sphere', tint, full)

    if (heightPath === undefined) continue

    capture(actor, 'terrain-bare', 'terrain', undefined, () => {
      seedPlaceholderKeys(actor)
      seedHeightMap(heightPath)
    })
    capture(actor, 'terrain-full', 'terrain', undefined, terrainFull)
    if (tint) capture(actor, 'terrain-full-tint', 'terrain', tint, terrainFull)
  }

  return states
}

/** Форма для записи в снимок: без шейдера (он один на все состояния и лежит отдельно). */
export function withoutShader({ shader: _shader, ...state }: CollectedState): ParityState {
  return state
}
