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

/** Поля записи `BODIES`, которыми интересуется `assertProceduralBodyKnobs` — подмножество `BodyGeneration` (тип живёт в `batch-synth-heightmaps.ts`, не импортируется, чтобы не тянуть весь батч-модуль в этот файл). */
export interface ProceduralBodyKnobs {
  name: string
  /** Единственная общая ручка `elevation`, которую процедурная ветка ДЕЙСТВИТЕЛЬНО читает (`elevationPeakMeters`) — guard её не трогает. */
  peakMeters?: number
  smoothSigmaTexels?: number
  highPassKm?: number
  peakPercentile?: number
}

/**
 * Громкий отказ на elevation-ручках у записи `procedural`: вход procedural
 * получает поле напрямую из `proceduralLuminance` (аналитическое, без
 * растровых артефактов) — `proceduralHeightField` в батче зовёт
 * elevation-конвейер со `smoothSigmaTexels` ЖЁСТКО 0 и без highPass/
 * peakPercentile, игнорируя одноимённые поля записи BODIES. Без этого guard'а
 * запись, дополненная по шаблону соседней elevation-записи (`smoothSigmaTexels`,
 * `highPassKm`, `peakPercentile`), тихо теряла бы эти ручки — их значения
 * нигде не читаются. `peakMeters` в проверку НЕ входит: процедурная ветка его
 * читает (`elevationPeakMeters(radiusMeters, body.peakMeters)`), это
 * единственная общая с elevation ручка, которая реально работает.
 */
export function assertProceduralBodyKnobs(body: ProceduralBodyKnobs): void {
  const ignored: string[] = []
  if (body.smoothSigmaTexels !== undefined) ignored.push('smoothSigmaTexels')
  if (body.highPassKm !== undefined) ignored.push('highPassKm')
  if (body.peakPercentile !== undefined) ignored.push('peakPercentile')

  if (ignored.length > 0) {
    throw new Error(
      `${body.name}: вход procedural не использует ручки elevation (${ignored.join(', ')}) — убери их из записи BODIES`
    )
  }
}
