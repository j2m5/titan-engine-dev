/**
 * Ручки композиции света суши (арка «Свет»); дефолты глобальные, БД не трогается.
 *
 * Инвариант: у терраформных тел `terrainLambert = 1` — окклюзия применяется
 * внутри ламберта; при 0 cavity/AO не действуют (дефолт кода 1).
 */
export interface TerrainLightParams {
  /** Доля окклюзии (cavity/AO/уступы) на ПРЯМОМ свете: 0 — только амбиент (физика), 1 — прежний вид. */
  terrainOcclusionDirect: number
  /** Вес небесного амбиента из irradiance-LUT атмосферы против серого пола: 0 — прежний вид. */
  skyAmbientStrength: number
  /** Сила тени облаков на земле; 0 — выключено. */
  cloudShadowStrength: number
  /** Высота облачного слоя для сдвига тени, км. */
  cloudShadowHeightKm: number
  /** Сила собственной тени рельефа (марш по низкой карте высот) на ПРЯМОМ свете; 0 — выключено. */
  terrainShadowStrength: number
  /** Множитель полутени тени рельефа; 1 — честная от углового радиуса солнца (с полом). */
  terrainShadowSoftness: number
  /** Сила блеска льда по шероховатости слоя детали; 0 — выключено. */
  iceGlintStrength: number
}

const DEFAULTS: TerrainLightParams = {
  terrainOcclusionDirect: 0.35,
  skyAmbientStrength: 1,
  cloudShadowStrength: 0.6,
  cloudShadowHeightKm: 6,
  terrainShadowStrength: 1,
  terrainShadowSoftness: 1,
  iceGlintStrength: 0
}

type Raw = { [K in keyof TerrainLightParams]?: unknown }

/** Заданные в data значения валидируются громко (контекст = имя тела); отсутствующие — дефолт. */
export function resolveTerrainLightParams(data: Raw | undefined, context: string): TerrainLightParams {
  const read = (field: keyof TerrainLightParams): number => {
    const raw = data?.[field]
    if (raw === undefined) return DEFAULTS[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`terrainLight ${context}: ${field} — не число: ${String(raw)}`)
    }
    return raw
  }

  const params: TerrainLightParams = {
    terrainOcclusionDirect: read('terrainOcclusionDirect'),
    skyAmbientStrength: read('skyAmbientStrength'),
    cloudShadowStrength: read('cloudShadowStrength'),
    cloudShadowHeightKm: read('cloudShadowHeightKm'),
    terrainShadowStrength: read('terrainShadowStrength'),
    terrainShadowSoftness: read('terrainShadowSoftness'),
    iceGlintStrength: read('iceGlintStrength')
  }

  for (const field of ['terrainOcclusionDirect', 'skyAmbientStrength', 'cloudShadowStrength', 'terrainShadowStrength', 'iceGlintStrength'] as const) {
    if (params[field] < 0 || params[field] > 1) throw new Error(`terrainLight ${context}: ${field} должен быть в [0, 1]: ${params[field]}`)
  }
  if (params.cloudShadowHeightKm <= 0) throw new Error(`terrainLight ${context}: cloudShadowHeightKm должен быть > 0: ${params.cloudShadowHeightKm}`)
  if (params.terrainShadowSoftness <= 0) throw new Error(`terrainLight ${context}: terrainShadowSoftness должен быть > 0: ${params.terrainShadowSoftness}`)

  return params
}
