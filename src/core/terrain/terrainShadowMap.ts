import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat, RepeatWrapping } from 'three'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import type { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { shadowMapDownsampleFactor, type ShadowHeightBits } from '@/core/terrain/terrainShadowBits'

/** Низкая карта высот и её масштабы — ровно вход чанка terrainShadowMarch. */
export interface TerrainShadowMap {
  /** До готовности — заглушка 1×1: ровная сфера на датуме. Объект меняется при установке. */
  texture: DataTexture
  /** Готова ли полная карта; до этого марш видит только тень самой сферы. */
  ready: boolean
  /** Нижняя граница карты, юниты сцены (высота над датумом, может быть < 0). */
  heightMinUnits: number
  /** Размах карты (max − min), юниты сцены: h = min + texel·range. */
  heightRangeUnits: number
  /** Угловой размер текселя по долготе полной карты, радианы: 2π / ширина. */
  texelAngle: number
  width: number
  height: number
}

type ReadyListener = (shadow: TerrainShadowMap) => void

interface Entry {
  shadow: TerrainShadowMap
  listeners: Set<ReadyListener>
  requested: boolean
}

/**
 * Одна карта тени на карту высот. Поля высот (`terrainHeightFieldFor`) кэшируются
 * по (карта, радиус, полоса) и могут существовать в нескольких экземплярах на
 * одну карту — текстура от радиуса не зависит, поэтому живёт здесь, по карте.
 * GL-ресурс не умирает со сборщиком: диспоз — из HeightFieldStorage.release/clear.
 * Постройка — через строитель патчей (воркер держит копию карты), см.
 * requestTerrainShadowMap; масштабы известны из заголовка сразу.
 */
const entries = new Map<HeightMapData, Entry>()

export function terrainShadowMapFor(map: HeightMapData): TerrainShadowMap {
  return entryFor(map).shadow
}

/** Подписка на готовность полной карты; возвращает отписку. Готовая карта подписчика не зовёт. */
export function onTerrainShadowMapReady(map: HeightMapData, listener: ReadyListener): () => void {
  const entry = entryFor(map)
  if (entry.shadow.ready) return (): void => {}

  entry.listeners.add(listener)
  return (): void => void entry.listeners.delete(listener)
}

/** Постройка полной карты у строителя — один запрос на карту, сколько бы полей её ни делили. */
export function requestTerrainShadowMap(field: TerrainHeightField, builder: TerrainPatchBuilder): void {
  const map = field.heightMap
  const entry = entryFor(map)
  if (entry.requested || entry.shadow.ready) return

  entry.requested = true
  builder.requestShadow(field, (bits: ShadowHeightBits): void => void installTerrainShadowBits(map, bits))
}

/** Ставит полную карту вместо заглушки. false — запись уже готова или снята (карта отпущена). */
export function installTerrainShadowBits(map: HeightMapData, bits: ShadowHeightBits): boolean {
  const entry = entries.get(map)
  if (!entry || entry.shadow.ready) return false

  entry.shadow.texture.dispose()
  entry.shadow.texture = makeTexture(bits.bits, bits.width, bits.height)
  entry.shadow.ready = true
  for (const listener of [...entry.listeners]) listener(entry.shadow)
  entry.listeners.clear()

  return true
}

export function disposeTerrainShadowMap(map: HeightMapData): boolean {
  const entry = entries.get(map)
  if (!entry) return false
  entry.shadow.texture.dispose()
  entries.delete(map)
  return true
}

export function disposeTerrainShadowMaps(): void {
  for (const entry of entries.values()) entry.shadow.texture.dispose()
  entries.clear()
}

function entryFor(map: HeightMapData): Entry {
  let entry = entries.get(map)
  if (!entry) {
    entry = { shadow: placeholderShadow(map), listeners: new Set(), requested: false }
    entries.set(map, entry)
  }
  return entry
}

/** Заглушка — ровная сфера на датуме (h = 0): марш даёт тень самого тела за терминатором. */
function placeholderShadow(map: HeightMapData): TerrainShadowMap {
  const factor = shadowMapDownsampleFactor(map.width)
  const width = Math.floor(map.width / factor)
  const range = map.maxMeters - map.minMeters
  const datum = range > 0 ? Math.min(Math.max(-map.minMeters / range, 0), 1) : 0

  return {
    texture: makeTexture(new Uint16Array([DataUtils.toHalfFloat(datum)]), 1, 1),
    ready: false,
    heightMinUnits: toThreeJSUnits(map.minMeters / 1000),
    heightRangeUnits: toThreeJSUnits(range / 1000),
    texelAngle: (2 * Math.PI) / width,
    width,
    height: Math.floor(map.height / factor)
  }
}

function makeTexture(bits: Uint16Array, width: number, height: number): DataTexture {
  const texture = new DataTexture(bits, width, height, RedFormat, HalfFloatType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}
