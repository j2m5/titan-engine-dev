import { atmosphereShader } from '@/core/renderables/Atmosphere/atmosphere'
import { adjustAtmosphereForTerrainFloor } from '@/core/renderables/Atmosphere/terrainFloorAdjust'
import { AtmosphereConfig, DensityProfileLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { shippedSnapshot } from '../helpers/shippedSnapshot'

/**
 * Underflow float32 в LUT пропускания и `0/0` в `GetTransmittance`.
 *
 * История: находка №8 ревью 2026-08-17 («Татуин: τ≈2124 у нового дна»)
 * оказалась УСТАРЕВШЕЙ арифметикой — она считана без клампа плотности
 * `clamp(density, 0, 1)` (GLSL `GetLayerDensity`) и до прокладки датума
 * `constantTerm: 1` (спайк 2026-08-22). Фактический худший тексель Татуина —
 * τ ≈ 36 → T ≈ 2e-16, обычный float32. Ближе всех к обрыву — Венера
 * (пол −5967 после гибрида 2026-08-24): τ ≈ 82.7 при пороге exp-underflow
 * float32 87.3 — запас ~4.6 единицы τ; следующее углубление пола или рост
 * плотности пересекает порог, T становится точным нулём, и оба деления
 * `T_a / T_b` в `GetTransmittance` дают `0/0 = NaN`, а `min(NaN, 1.0)` по
 * спецификации GLSL ES недетерминирован между вендорами.
 *
 * Лечение — структурное, не пер-тело: пол на знаменателе отношения
 * (`SafeTransmittanceRatio`) и NaN-стойкий гвард экстраполяции Ми. После
 * него нулевой тексель LUT безвреден: 0/max(0, ε) = 0 — честное «свет не
 * прошёл», без NaN и без вендорной лотереи.
 */

/** Плотность слоя как в GLSL GetLayerDensity — включая кламп [0, 1]. */
function layerDensity(layer: DensityProfileLayer, altitudeKm: number): number {
  const d = layer.expTerm * Math.exp(layer.expScale * altitudeKm) + layer.linearTerm * altitudeKm + layer.constantTerm
  return Math.min(1, Math.max(0, d))
}

function profileDensity(layers: [DensityProfileLayer, DensityProfileLayer], altitudeKm: number): number {
  return altitudeKm < layers[0].width ? layerDensity(layers[0], altitudeKm) : layerDensity(layers[1], altitudeKm)
}

/** Длина до верхней границы: корень ray-sphere, дискриминант клампится нулём как в GLSL. */
function distanceToTop(rKm: number, mu: number, topKm: number): number {
  const discriminant = rKm * rKm * (mu * mu - 1) + topKm * topKm
  return Math.max(0, -rKm * mu + Math.sqrt(Math.max(0, discriminant)))
}

/** Оптическая длина как ComputeOpticalLengthToTopAtmosphereBoundary: трапеция, 500 сэмплов. */
function opticalLength(
  profile: [DensityProfileLayer, DensityProfileLayer],
  bottomKm: number,
  topKm: number,
  rKm: number,
  mu: number
): number {
  const SAMPLE_COUNT = 500
  const dx = distanceToTop(rKm, mu, topKm) / SAMPLE_COUNT
  let result = 0
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const dI = i * dx
    const rI = Math.sqrt(dI * dI + 2 * rKm * mu * dI + rKm * rKm)
    const weight = i === 0 || i === SAMPLE_COUNT ? 0.5 : 1
    result += profileDensity(profile, rI - bottomKm) * weight * dx
  }
  return result
}

/** Худший (максимальный по каналам) показатель экспоненты τ по сетке скользящих лучей. */
function worstTau(config: AtmosphereConfig): number {
  let worst = 0
  const { bottomRadius: bottom, topRadius: top } = config

  // Худшая точка LUT — низкий r и скользящий mu (луч гладит дно): τ монотонно
  // растёт к этой границе, сетки из 17 радиусов с mu на самой границе горизонта
  // достаточно (сверено с полным обходом сетки 256×64 при исследовании).
  for (let k = 0; k <= 16; k++) {
    const rKm = bottom + ((top - bottom) * k) / 16
    const ratio = bottom / rKm
    const muHorizon = -Math.sqrt(Math.max(0, 1 - ratio * ratio))

    const tauRay = opticalLength(config.rayleighDensity, bottom, top, rKm, muHorizon)
    const tauMie = opticalLength(config.mieDensity, bottom, top, rKm, muHorizon)
    const tauAbs = opticalLength(config.absorptionDensity, bottom, top, rKm, muHorizon)

    for (let c = 0; c < 3; c++) {
      const tau =
        config.rayleighScattering[c] * tauRay + config.mieExtinction[c] * tauMie + config.absorptionExtinction[c] * tauAbs
      worst = Math.max(worst, tau)
    }
  }

  return worst
}

/** Зеркало SafeTransmittanceRatio из GLSL: пол знаменателя, кламп единицей. */
function safeTransmittanceRatio(numerator: number, denominator: number): number {
  return Math.min(numerator / Math.max(denominator, 1e-30), 1)
}

describe('GetTransmittance: пол знаменателя против 0/0 при underflow LUT', () => {
  it('страж GLSL: оба деления T_a/T_b идут через SafeTransmittanceRatio с полом знаменателя', () => {
    expect(atmosphereShader).toContain('SafeTransmittanceRatio')
    expect(atmosphereShader).toContain('max(denominator, DimensionlessSpectrum(1e-30))')
    // прежняя форма — голое деление сэмплов под min(..., 1.0) — не должна вернуться
    expect(atmosphereShader).not.toMatch(/min\(\s*GetTransmittanceToTopAtmosphereBoundary/)
  })

  it('страж GLSL: гвард экстраполяции Ми не пропускает NaN (NaN <= 0.0 == false)', () => {
    expect(atmosphereShader).toContain('!(scattering.r > 0.0)')
    expect(atmosphereShader).not.toContain('if (scattering.r <= 0.0)')
  })

  it('зеркало отношения: конечно при нулевом знаменателе, честно при живых значениях', () => {
    // T = 0 в обоих сэмплах (за порогом underflow): 0/max(0, ε) = 0, не NaN
    expect(safeTransmittanceRatio(0, 0)).toBe(0)
    expect(Number.isFinite(safeTransmittanceRatio(0, 0))).toBe(true)
    // живые значения выше пола не искажаются (Венера сегодня: T ~ 1.2e-36 < ε —
    // пол СРАБОТАЕТ, отношение занижено; это осознанная цена: при T ~ 1e-36
    // свет физически не проходит, точность отношения там не имеет смысла)
    expect(safeTransmittanceRatio(0.25, 0.5)).toBeCloseTo(0.5, 12)
    expect(safeTransmittanceRatio(0.7, 0.2)).toBe(1)
  })
})

describe('LUT пропускания: худший τ боевых конфигов конечен, отношение выживает и за порогом', () => {
  it('все атмосферы БД с реальными полами: τ конечен, защищённое отношение конечно', async () => {
    const snapshot = await shippedSnapshot()
    const atmospheres = snapshot.renderingObjects.filter((row) => {
      const data = row.data as Partial<AtmosphereConfig>
      return data.rayleighDensity !== undefined && typeof data.bottomRadius === 'number'
    })

    // 18 атмосфер в базе — если стало меньше, фильтр или данные разъехались
    expect(atmospheres.length).toBeGreaterThanOrEqual(18)

    for (const row of atmospheres) {
      const config = row.data as unknown as AtmosphereConfig
      const adjusted = adjustAtmosphereForTerrainFloor(config, config.terrainFloorMeters ?? 0)
      const tau = worstTau(adjusted)

      expect(Number.isFinite(tau), `row ${row.id}: τ=${tau}`).toBe(true)

      // T в float32 может быть и точным нулём (за порогом τ ≈ 87.3) — это
      // штатно: защищённое отношение обязано остаться конечным
      const t = Math.fround(Math.exp(-tau))
      expect(Number.isFinite(safeTransmittanceRatio(t, t)), `row ${row.id}: τ=${tau}, T=${t}`).toBe(true)
    }
  })

  it('пин запасов: Татуин далёк от обрыва, Венера — ближайшее к нему тело', async () => {
    const snapshot = await shippedSnapshot()
    const configOf = (rowId: number): AtmosphereConfig => {
      const row = snapshot.renderingObjects.find((r) => r.id === rowId)!
      const config = row.data as unknown as AtmosphereConfig
      return adjustAtmosphereForTerrainFloor(config, config.terrainFloorMeters ?? 0)
    }

    // Татуин (row 24): «τ≈2124» из ревью 2026-08-17 устарело — кламп плотности
    // и прокладка датума держат τ на порядок ниже порога underflow 87.3
    const tatooine = worstTau(configOf(24))
    expect(tatooine).toBeGreaterThan(30)
    expect(tatooine).toBeLessThan(45)

    // Венера (row 13, пол −5967 после гибрида 2026-08-24): у порога, но ниже.
    // Если этот ассерт упал после углубления пола/уплотнения — это НЕ обрыв
    // рендера (SafeTransmittanceRatio терпит T=0), но сигнал, что LUT в этой
    // зоне стал нулевым: свет за горизонтом гаснет полностью, стоит пересмотреть
    // плотности или принять осознанно, обновив границы пина.
    const venus = worstTau(configOf(13))
    expect(venus).toBeGreaterThan(70)
    expect(venus).toBeLessThan(87.3)
  })
})
