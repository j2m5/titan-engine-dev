import { Texture } from 'three'
import { Actor } from '@/core/models/Actor'
import type { IPlanetRenderingObject } from '@/core/models/types'
import { readRenderingData } from '@/core/helpers/renderingData'
import { proceduralDiffuseKey } from '@/core/services/ProceduralSurfaceGenerator'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'

/**
 * Сиды реестров под материалы тел категории 4: заглушки текстур вместо
 * PlaceholderTexture (канваса в jsdom нет) и карта высот-пустышка.
 */

const RING_CATEGORY_ID = 6

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
export function diffuseKeyOf(actor: Actor): string {
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
  for (const ring of ringsOf(actor)) {
    const ringPath = ring.resources.first()?.getAttribute('path')
    if (typeof ringPath === 'string') keys.add(ringPath)
  }
  for (const key of keys) seedTexture(key)
}

/**
 * '' нужна только конструктору (кольца через `?? ''`): в рантайме под ''
 * в реестре ничего нет, иначе тело без ночной/облачной/specular-строки
 * нашло бы её как фантомную карту. Звать после конструирования материала.
 */
export function dropEmptyPlaceholder(): void {
  resourceStorage.deleteTexture('')
}

export function seedFull(actor: Actor, withSteep: boolean): void {
  const keys = new Set<string>([...pathsOf(actor), ...ringsOf(actor).flatMap(pathsOf)])
  if (withSteep) for (const p of Object.values(STEEP_DETAIL_PATHS)) keys.add(p)
  for (const key of keys) if (!resourceStorage.isExistsTexture(key)) seedTexture(key)
}
