import { proceduralField } from '@/core/terrain/proceduralSurfaceField'
import { validateProceduralSurface } from '@/core/terrain/proceduralSurfaceParams'
import { RenderingObjects } from '@storage/database/renderingObjects'

/**
 * Направление текселя эквиректангулярной карты (x,y) — обратная развёртка
 * `dirToUv`, зеркало `texelDirection` из `synthHeightMap.ts`: полутекселные
 * центры (строка 0 — север), θ=π·v, φ=2π·u, x=−cos(φ)·sinθ, y=cosθ,
 * z=sin(φ)·sinθ.
 */
function texelDirection(x: number, y: number, width: number, height: number): [number, number, number] {
  const u = (x + 0.5) / width
  const v = (y + 0.5) / height
  const theta = Math.PI * v
  const phi = 2 * Math.PI * u
  const sinTheta = Math.sin(theta)

  return [-Math.cos(phi) * sinTheta, Math.cos(theta), Math.sin(phi) * sinTheta]
}

/**
 * Растр яркости [0,1] сид-поля процедурного облика тела `actorId` — вход для
 * elevation-пути батча высот (`buildElevationHeightField`). Ручки поля
 * (`ProceduralSurfaceParams`) НЕ дублируются в BODIES — читаются из
 * `RenderingObjects` по actorId, единственный источник истины (Task 6).
 * `proceduralField` возвращает значение ≈[-1,1] — растр карты (0-1) даёт
 * `(v+1)/2`, конвенция координат текселя та же, что и у честных карт высот
 * (`dirToUv`), — поле детерминировано (симплекс чист от внешнего состояния),
 * шов долготы непрерывен (3D-поле, не 2D-развёртка).
 */
export function proceduralLuminance(actorId: number, width: number, height: number): Float64Array {
  const entry = RenderingObjects.find((object) => object.actorId === actorId)
  if (!entry) throw new Error(`proceduralLuminance: нет записи RenderingObjects для actorId ${actorId}`)

  const raw = (entry.data as { proceduralSurface?: unknown }).proceduralSurface
  if (raw === undefined) {
    throw new Error(`proceduralLuminance: proceduralSurface не задан у actorId ${actorId}`)
  }
  const params = validateProceduralSurface(raw, `actorId ${actorId}`)

  const out = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [dirX, dirY, dirZ] = texelDirection(x, y, width, height)
      const v = proceduralField(dirX, dirY, dirZ, params)
      out[y * width + x] = (v + 1) / 2
    }
  }

  return out
}
