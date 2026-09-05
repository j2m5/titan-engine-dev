import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

const MOON_HEIGHT_PATH = 'storage/images/textures/planets/moon/moon_height.raw'
const RADIUS_KM = 1737.4

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// Пины ОТНОСИТЕЛЬНЫЕ (полоса против strength 0 на той же карте Луны).
// ДВЕ РАЗНЫЕ картины на двух уровнях (не путать!):
//  - постройка ПОЛЯ: полоса ≈ пренебрежимая добавка на фоне ~2 c холодного
//    computeAux без .aux — абсолютное время тут свойство базовой постройки,
//    не арки B (тест ниже пинует именно эту добавку, не полное время);
//  - постройка ПАТЧА: полоса — БОЛЬШАЯ часть бюджета (см. докблок второго
//    it) — здесь относительное сравнение показывает обратное: полоса не
//    «почти бесплатна», она доминирует. Абсолютные числа обоих уровней —
//    в docs/terrain-handoff.md.
describe.skipIf(!existsSync(MOON_HEIGHT_PATH))('Бюджет полосы B на карте Луны: накладные расходы против strength 0', () => {
  let on: TerrainHeightField
  let off: TerrainHeightField
  let constructOnMs: number
  let constructOffMs: number

  beforeAll(() => {
    const map: HeightMapData = parseHeightMap(toArrayBuffer(readFileSync(MOON_HEIGHT_PATH)))

    // прогрев JIT ОБОИХ путей конструктора (computeAux — общий, плюс
    // MidbandField/MidbandEnvelopeGrid — только у полосы) ДО замера: без
    // него первое исполнение midband-кода несёт штраф холодного байткода
    // порядка 500-700 мс (замерено), который ложится на «on», если он
    // измеряется первым, — не реальная маргинальная стоимость полосы, а
    // разовая цена JIT-компиляции формы вызова, как у прогрева патча ниже
    new TerrainHeightField(map, RADIUS_KM)

    let start = performance.now()
    on = new TerrainHeightField(map, RADIUS_KM)
    constructOnMs = performance.now() - start

    start = performance.now()
    off = new TerrainHeightField(map, RADIUS_KM, { ...MIDBAND_DEFAULTS, midbandStrength: 0 })
    constructOffMs = performance.now() - start
  })

  it('постройка TerrainHeightField с полосой не дороже той же карты без полосы больше чем на 500 мс (огибающая ≈ 50 мс)', () => {
    expect(
      constructOnMs,
      `постройка поля: с полосой ${constructOnMs.toFixed(1)} мс, без полосы (strength 0) ${constructOffMs.toFixed(1)} мс`
    ).toBeLessThanOrEqual(constructOffMs + 500)
  })

  /**
   * НАХОДКА (не совпадает с ожиданием фикс-раунда 1 «полоса стоит почти
   * ничего» — то ожидание было о постройке ПОЛЯ, не патча): на уровне
   * ОДНОГО патча полоса — не мелкая добавка, а бОльшая часть его бюджета.
   * `off` (map-only, без семплов `midbandSample`/`midbandTilt` по вершинам)
   * — порядка 2 мс на узел L8/64seg; `on` (3 гребневых октавы `snoiseGrad3`
   * по ~4200 вершинам патча) — порядка 7-9 мс, то есть полоса добавляет
   * ~5-8 мс, а не доли миллисекунды. Отсюда МНОЖИТЕЛЬ (изначальный план
   * фикс-раунда 1: `onMedian <= 1.5 * offMedian`) — нерабочая метрика:
   * знаменатель `off` — те же 1.5-2.3 мс, шум планировщика/GC на такой
   * величине даёт разброс отношения от ~3× до ~6× при одном и том же коде.
   * Пин — АБСОЛЮТНАЯ дельта с потолком, тем же приёмом, что у постройки
   * поля выше; потолок 10 мс — с запасом над измеренными 4.3-7.9 мс дельты
   * (13 прогонов на этой машине).
   */
  it('buildTerrainPatchGeometry у поверхности: полоса добавляет к патчу без неё не больше 10 мс (медиана, чередующиеся замеры)', () => {
    const index = buildPatchIndex(64)
    const wrap = detailWrapFor(undefined)
    const build = (field: TerrainHeightField): number => {
      const start = performance.now()
      buildTerrainPatchGeometry(field, 0, 200, 200, 8, 64, index, 0, wrap)
      return performance.now() - start
    }

    build(on) // прогрев обеих форм вызова — вне замера
    build(off)

    // Чередование on/off по раундам (не «все on, потом все off») гасит
    // дрейф JIT/GC между двумя сериями измерений, который иначе решал бы,
    // чей медианный замер окажется ниже.
    const ROUNDS = 9
    const onSamples: number[] = []
    const offSamples: number[] = []
    for (let round = 0; round < ROUNDS; round++) {
      if (round % 2 === 0) {
        onSamples.push(build(on))
        offSamples.push(build(off))
      } else {
        offSamples.push(build(off))
        onSamples.push(build(on))
      }
    }

    const onMedian = median(onSamples)
    const offMedian = median(offSamples)

    expect(
      onMedian,
      `медиана постройки патча: с полосой ${onMedian.toFixed(3)} мс, без полосы ${offMedian.toFixed(3)} мс (дельта ${(onMedian - offMedian).toFixed(3)} мс)`
    ).toBeLessThanOrEqual(offMedian + 10)
  })
})
