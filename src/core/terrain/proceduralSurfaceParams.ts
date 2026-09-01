/**
 * Потолок октав — контракт с GPU-циклом proceduralFieldChunk (константная граница
 * цикла GLSL). Менять только синхронно с чанком.
 */
export const MAX_FIELD_OCTAVES = 12

/**
 * Ручки процедурной поверхности тела (см. спеку 2026-08-31): одно сидированное
 * fBM-поле кормит и рантайм-диффуз (GPU), и офлайн-высоты (CPU). Все поля
 * обязательные — молчаливый дефолт облика недопустим (решение владельца).
 */
export interface ProceduralSurfaceParams {
  seed: number
  /** Периодов базовой октавы на радиан дуги (масштаб крупных форм). */
  frequencyPerRadius: number
  octaves: number
  gain: number
  lacunarity: number
  /** 1 — линейно; >1 — острее гребни (sign(v)·|v|^contrast). */
  contrast: number
  /** 4 опорных цвета #rrggbb: низины → вершины. */
  palette: [string, string, string, string]
  /** 0..1 — вес пятнистости альбедо мелкой октавой. */
  albedoNoise: number
}

const HEX = /^#[0-9a-fA-F]{6}$/

export function validateProceduralSurface(value: unknown, context: string): ProceduralSurfaceParams {
  const fail = (field: string, detail: string): never => {
    throw new Error(`proceduralSurface ${context}: ${field} — ${detail}`)
  }
  if (typeof value !== 'object' || value === null) fail('объект', `получено ${String(value)}`)
  const v = value as Record<string, unknown>

  const num = (field: string): number => {
    const n = v[field]
    if (typeof n !== 'number' || !Number.isFinite(n)) fail(field, `не число: ${String(n)}`)
    return n as number
  }

  const seed = num('seed')
  if (!Number.isInteger(seed)) fail('seed', `должен быть целым: ${seed}`)
  const octaves = num('octaves')
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > MAX_FIELD_OCTAVES) fail('octaves', `целое в [1, ${MAX_FIELD_OCTAVES}]: ${octaves}`)
  const frequencyPerRadius = num('frequencyPerRadius')
  if (frequencyPerRadius <= 0) fail('frequencyPerRadius', `> 0: ${frequencyPerRadius}`)
  const gain = num('gain')
  if (gain <= 0) fail('gain', `> 0: ${gain}`)
  const lacunarity = num('lacunarity')
  if (lacunarity <= 0) fail('lacunarity', `> 0: ${lacunarity}`)
  const contrast = num('contrast')
  if (contrast <= 0) fail('contrast', `> 0: ${contrast}`)
  const albedoNoise = num('albedoNoise')
  if (albedoNoise < 0 || albedoNoise > 1) fail('albedoNoise', `в [0,1]: ${albedoNoise}`)

  const palette = v.palette
  if (!Array.isArray(palette) || palette.length !== 4 || palette.some((c) => typeof c !== 'string' || !HEX.test(c))) {
    fail('palette', 'ровно 4 цвета #rrggbb')
  }

  return {
    seed, frequencyPerRadius, octaves, gain, lacunarity, contrast,
    palette: [...(palette as string[])] as ProceduralSurfaceParams['palette'], albedoNoise
  }
}

/**
 * Сид → доменный сдвиг поля. Считается ТОЛЬКО на CPU и уходит в GLSL юниформом —
 * шейдер сид не хеширует, паритет GPU/CPU держится на одном симплексе.
 * Разнос сотен единиц декоррелирует соседние сиды (октавы живут на масштабе ~1).
 */
export function seedOffset(seed: number): { x: number; y: number; z: number } {
  const golden = (n: number): number => {
    const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
    return (x - Math.floor(x)) * 200 - 100
  }
  return { x: golden(seed), y: golden(seed + 1_000_003), z: golden(seed + 2_000_033) }
}
