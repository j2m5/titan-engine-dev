import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import { selectTerrainNodes, type SelectParams } from '@/core/terrain/terrainQuadtreeSelect'
import { MAX_LIVE_PATCHES } from '@/core/terrain/TerrainPatchPool'
import { terrain as terrainConfig } from '@/config/terrain'
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

  /**
   * Факт-пин (не порог 0.8·MAX_LIVE_PATCHES, как у синтетической карты в
   * terrainQuadtreeSelect.spec — там дискриминирует регресс потолка глубины,
   * здесь другая цель): на РЕАЛЬНОЙ карте Луны у поверхности (H=2160,
   * splitPixels/mergeFactor из конфига) набор листьев ≈ 860–910. Живых
   * патчей больше листьев (split/merge даёт нахлёст истории, ×1.16 по
   * замеру) — при потолке 1024 запас у поверхности МЕНЬШЕ, чем кажется
   * из голого количества листьев: пул может насыщаться без дыр в кадре
   * (деградация LOD, не визуальный провал), рычаг — MAX_LIVE_PATCHES
   * (+78 МБ за +256 слотов) — решение владельца после приёмки.
   */
  it('selectTerrainNodes у поверхности реальной карты Луны (H=2160) — набор листьев в пределах потолка живых патчей', () => {
    const field = on
    const dir = new Vector3(1, 0, 0)
    const r = field.surfaceRadiusUnits(dir)
    const cameraLocal = dir.clone().multiplyScalar(r + toThreeJSUnits(0.2)) // 200 м над поверхностью

    // Реальный фрустум (как в TerrainPatchGroup.updateObject), не null: без
    // культинга по видимости отбор проходит ВЕСЬ кубосфер по одной дистанции/SSE
    // (даже дальнюю сторону тела) — на реальной шероховатой карте это даёт
    // 2400-4200 листьев, что не отражает то, что реально строится за кадр.
    // Камера смотрит вдоль касательной (типичный ракурс игрока у поверхности).
    const up = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
    const tangent = new Vector3().crossVectors(up, dir).normalize()
    const fovYDegrees = 70
    const camera = new PerspectiveCamera(fovYDegrees, 16 / 9, 0.0001, 1e9)
    camera.position.copy(cameraLocal)
    camera.up.copy(dir)
    camera.lookAt(cameraLocal.clone().add(tangent))
    camera.updateMatrixWorld(true)
    const frustumLocal = new Frustum()
    frustumLocal.setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))

    const params: SelectParams = {
      field,
      cameraLocal,
      frustumLocal,
      screenHeight: 2160,
      fovYRadians: (fovYDegrees * Math.PI) / 180,
      splitPixels: terrainConfig.terrain.sseSplitPixels,
      mergeFactor: terrainConfig.terrain.sseMergeFactor,
      currentlySplit: new Set<number>()
    }

    const { leaves } = selectTerrainNodes(params)
    console.log(`selectTerrainNodes H=2160 у поверхности Луны: leaves.length=${leaves.length}`)

    expect(leaves.length).toBeLessThanOrEqual(MAX_LIVE_PATCHES)
  })
})
