/**
 * Сверка объявленного в БД пола рельефа (`AtmosphereConfig.terrainFloorMeters`)
 * с фактическим минимумом карты высот.
 *
 * Зачем вообще сверка. Пол лежит в конфиге атмосферы, а не читается из карты,
 * потому что `bottomRadius` запечён в LUT и знать его надо в конструкторе,
 * куда карта после гейта не приезжает никогда (см. докблок поля). Цена такого
 * решения — дубль факта о карте, способный разойтись с ней при пересборке
 * ассета. Этот предикат и есть плата по счёту: офлайн-прогон
 * `build:terrain-aux-all` парсит заголовок каждой карты и сообщает, где число
 * не поставлено или разъехалось.
 */
export type TerrainFloorStatus = {
  /** ok — сходится; missing — не объявлено или объявлено не числом; mismatch — разошлось. */
  status: 'ok' | 'missing' | 'mismatch'
  /** Что должно быть объявлено: min(0, minMeters) карты. */
  expected: number
  /** Что объявлено (как лежит в БД, без приведения) — для сообщения о расхождении. */
  declared: unknown
}

/**
 * Допуск сходимости, метры. Границы диапазона живут в заголовке карты как f32,
 * а в БД человек вбивает округлённое — расхождение до метра не значит ничего
 * ни для дна атмосферы (метр на десятках километров), ни для оптики.
 */
const TOLERANCE_METERS = 1

export function terrainFloorStatus(declared: unknown, minMeters: number): TerrainFloorStatus {
  const expected = Math.min(0, minMeters)

  if (typeof declared !== 'number' || !Number.isFinite(declared)) {
    return { status: 'missing', expected, declared }
  }

  return {
    status: Math.abs(declared - expected) > TOLERANCE_METERS ? 'mismatch' : 'ok',
    expected,
    declared
  }
}
