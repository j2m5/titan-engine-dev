import { adjustAtmosphereForTerrainFloor } from '@/core/renderables/Atmosphere/terrainFloorAdjust'
import { AtmosphereConfig, DensityProfileLayer, EMPTY_LAYER, expLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'

function stubConfig(extra: Partial<AtmosphereConfig> = {}): AtmosphereConfig {
  return {
    solarIrradiance: [1.474, 1.8504, 1.91198],
    sunAngularRadius: 0.004,
    bottomRadius: 3390,
    topRadius: 3470,
    rayleighDensity: [EMPTY_LAYER, expLayer(8)],
    rayleighScattering: [0.005802, 0.013558, 0.0331],
    mieDensity: [EMPTY_LAYER, expLayer(1.2)],
    mieScattering: [0.003996, 0.003996, 0.003996],
    mieExtinction: [0.00444, 0.00444, 0.00444],
    miePhaseFunctionG: 0.8,
    absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
    absorptionExtinction: [0, 0, 0],
    groundAlbedo: [0.1, 0.1, 0.1],
    muSMin: -0.2,
    exposure: 4,
    hdrKnee: 0.3,
    ...extra
  }
}

/** Плотность слоя как в GLSL GetLayerDensity — включая кламп [0, 1]. */
function layerDensity(layer: DensityProfileLayer, altitudeKm: number): number {
  const d = layer.expTerm * Math.exp(layer.expScale * altitudeKm) + layer.linearTerm * altitudeKm + layer.constantTerm
  return Math.min(1, Math.max(0, d))
}

function profileDensity(layers: [DensityProfileLayer, DensityProfileLayer], altitudeKm: number): number {
  return altitudeKm < layers[0].width ? layerDensity(layers[0], altitudeKm) : layerDensity(layers[1], altitudeKm)
}

describe('adjustAtmosphereForTerrainFloor: подгонка дна атмосферы под пол рельефа', () => {
  it('пол ≥ 0 — конфиг возвращается как есть (тело без карты или рельеф выше опорной сферы)', () => {
    const config = stubConfig()

    expect(adjustAtmosphereForTerrainFloor(config, 0)).toBe(config)
    expect(adjustAtmosphereForTerrainFloor(config, 1500)).toBe(config)
  })

  it('дно опускается ровно на |пол| в километрах, верх не трогается', () => {
    const adjusted = adjustAtmosphereForTerrainFloor(stubConfig(), -8174.25)

    expect(adjusted.bottomRadius).toBeCloseTo(3390 - 8.17425, 9)
    expect(adjusted.topRadius).toBe(3470)
  })

  it('exp-профиль: оптика на прежней опорной высоте тождественна (коэффициент × плотность)', () => {
    const config = stubConfig()
    const dKm = 8.17425
    const adjusted = adjustAtmosphereForTerrainFloor(config, -8174.25)

    // Опорная сфера теперь на высоте dKm над новым дном
    for (let c = 0; c < 3; c++) {
      const before = config.rayleighScattering[c] * profileDensity(config.rayleighDensity, 0)
      const after = adjusted.rayleighScattering[c] * profileDensity(adjusted.rayleighDensity, dKm)
      expect(after).toBeCloseTo(before, 9)
    }
  })

  it('exp-компенсация живёт в профиле: коэффициенты не трогаются, множитель уходит в expTerm', () => {
    const dKm = 8.17425
    const adjusted = adjustAtmosphereForTerrainFloor(stubConfig(), -8174.25)

    // Коэффициенты — паспорт вещества, они не зависят от того, где мы провели дно
    expect(adjusted.mieScattering).toEqual([0.003996, 0.003996, 0.003996])
    expect(adjusted.mieExtinction).toEqual([0.00444, 0.00444, 0.00444])
    expect(adjusted.rayleighScattering).toEqual([0.005802, 0.013558, 0.0331])

    expect(adjusted.mieDensity[1].expTerm).toBeCloseTo(Math.exp(dKm / 1.2), 6)
    expect(adjusted.rayleighDensity[1].expTerm).toBeCloseTo(Math.exp(dKm / 8), 9)
    expect(adjusted.mieDensity[1].expScale).toBe(-1 / 1.2)
  })

  /**
   * Регрессия хотфикса 2026-08-17: шейдер ведёт луч до АНАЛИТИЧЕСКОГО дна, поэтому
   * слой между новым дном и датумом лежит под реальной поверхностью и всё равно
   * попадает в интеграл. Пока компенсация сидела в коэффициентах, его толща росла
   * как β·H·(e^{d/H}−1) — Татуин (d/H ≈ 12.9) получал τ ≈ 2·10³ и заливался
   * непрозрачной дымкой. С компенсацией в профиле кламп плотности [0,1] в
   * GetLayerDensity держит подповерхностный слой на ρ=1, и толща линейна: τ = β·d.
   */
  it('подповерхностный слой не даёт оптики вовсе — нижний слой профиля обнулён', () => {
    // Прежде здесь закреплялось ρ≡1 под датумом: компенсация жила в профиле, и
    // кламп шейдера держал раздутую экспоненту на потолке. Толща выходила
    // линейной (τ = β·d) вместо экспоненциальной — это спасло от τ≈2·10³, но
    // оставило паразитный слой в интеграле КАЖДОГО луча к диску планеты.
    //
    // Оценка τ = β·d вертикальная, и в этом была ошибка: луч к лимбу проходит
    // тот же слой вдоль хорды 2·√(2Rd). У Татуина (R=5232 км, d=15.5 км) это
    // 805 км против 15.5 — в 52 раза больше; у Земли при поле −11 км в 68 раз.
    // Отсюда пересинение диска и мгла на лимбе.
    //
    // Лечение: нижний слой профиля становится нулевой прокладкой толщиной d.
    // GetProfileDensity берёт его при altitude < layers[0].width, кламп даёт
    // ровно 0 — паразитный вклад исчезает, а не уменьшается. Раз ρ=0, длина
    // пути роли не играет: вклад нулевой для луча любого наклона.
    const floorMeters = -15475.03 // пол Татуина
    const dKm = -floorMeters / 1000
    const adjusted = adjustAtmosphereForTerrainFloor(stubConfig(), floorMeters)

    for (const h of [0, 1, 5, 10, dKm - 0.01]) {
      expect(profileDensity(adjusted.mieDensity, h)).toBe(0)
      expect(profileDensity(adjusted.rayleighDensity, h)).toBe(0)
    }

    // Интеграл плотности строго ПОД датумом равен нулю. Срединные точки, а не
    // трапеция: её крайний узел лёг бы ровно на датум, где плотность уже
    // приземная, и дал бы ненулевой хвост от границы, а не от слоя.
    const N = 2000
    let column = 0
    for (let i = 0; i < N; i++) {
      column += (profileDensity(adjusted.mieDensity, ((i + 0.5) / N) * dKm) * dKm) / N
    }
    expect(column).toBe(0)

    // Границы ловят возврат обеих прежних схем: коэффициентной (τ≈2·10³) и
    // профильной с клампом (τ = β·d, здесь 0.069 — уже больше настоящей
    // колонны β·H = 0.0053, а на лимбе эта добавка множится ещё на ~52)
    expect(column * adjusted.mieExtinction[0]).toBe(0)
    expect(1.2 * (Math.exp(dKm / 1.2) - 1) * 0.00444).toBeGreaterThan(1000)
    expect(dKm * 0.00444).toBeGreaterThan(0.06)
  })

  it('граница слоёв стоит ровно на датуме — прокладка не съедает атмосферу над ним', () => {
    // Ширина нижнего слоя обязана совпадать с глубиной опускания: чуть выше
    // датума уже работает верхний слой с настоящей приземной плотностью.
    const floorMeters = -8174.25
    const dKm = -floorMeters / 1000
    const adjusted = adjustAtmosphereForTerrainFloor(stubConfig(), floorMeters)

    expect(adjusted.mieDensity[0].width).toBeCloseTo(dKm, 9)
    expect(adjusted.rayleighDensity[0].width).toBeCloseTo(dKm, 9)

    expect(profileDensity(adjusted.mieDensity, dKm)).toBeCloseTo(1, 9)
    expect(profileDensity(adjusted.rayleighDensity, dKm)).toBeCloseTo(1, 9)
  })

  it('над датумом профиль тождествен исходному — вид атмосферы не меняется', () => {
    const config = stubConfig()
    const dKm = 8.17425
    const adjusted = adjustAtmosphereForTerrainFloor(config, -8174.25)

    for (const h of [0, 0.5, 2, 8, 30, 60]) {
      expect(profileDensity(adjusted.mieDensity, h + dKm)).toBeCloseTo(profileDensity(config.mieDensity, h), 9)
      expect(profileDensity(adjusted.rayleighDensity, h + dKm)).toBeCloseTo(profileDensity(config.rayleighDensity, h), 9)
    }
  })

  it('линейная «палатка» поглощения: плотность на той же абсолютной высоте сохраняется', () => {
    // Озоновый профиль Yavin IV: пик на 25 км над старым дном, палатка 10..40 км
    const tent: [DensityProfileLayer, DensityProfileLayer] = [
      { width: 25, expTerm: 0, expScale: 0, linearTerm: 1 / 15, constantTerm: -2 / 3 },
      { width: 0, expTerm: 0, expScale: 0, linearTerm: -1 / 15, constantTerm: 8 / 3 }
    ]
    const config = stubConfig({ absorptionDensity: tent, absorptionExtinction: [6.5e-4, 0.001881, 8.5e-5] })
    const dKm = 18.941
    const adjusted = adjustAtmosphereForTerrainFloor(config, -18941)

    // Высота h над старым дном = h + d над новым; профиль обязан совпасть
    for (const h of [0, 10, 17, 25, 33, 40, 55]) {
      expect(profileDensity(adjusted.absorptionDensity, h + dKm)).toBeCloseTo(profileDensity(tent, h), 9)
    }
    // Коэффициенты палатки не масштабируются — сдвиг сохраняет их смысл
    expect(adjusted.absorptionExtinction).toEqual([6.5e-4, 0.001881, 8.5e-5])
  })

  it('пустой профиль (absorption без слоёв) остаётся пустым', () => {
    const adjusted = adjustAtmosphereForTerrainFloor(stubConfig(), -8174.25)

    expect(adjusted.absorptionDensity).toEqual([EMPTY_LAYER, EMPTY_LAYER])
    expect(adjusted.absorptionExtinction).toEqual([0, 0, 0])
  })

  it('неопознанная форма профиля — коэффициенты не трогаются, дно всё равно опущено', () => {
    const exotic: [DensityProfileLayer, DensityProfileLayer] = [
      EMPTY_LAYER,
      { width: 0, expTerm: 1, expScale: -0.125, linearTerm: 0, constantTerm: 0.5 }
    ]
    const config = stubConfig({ rayleighDensity: exotic })
    const adjusted = adjustAtmosphereForTerrainFloor(config, -8174.25)

    expect(adjusted.bottomRadius).toBeCloseTo(3390 - 8.17425, 9)
    expect(adjusted.rayleighScattering).toEqual(config.rayleighScattering)
  })

  it('вход не мутирует — конфиг принадлежит строке данных', () => {
    const config = stubConfig()
    const snapshot = JSON.parse(JSON.stringify(config)) as unknown

    adjustAtmosphereForTerrainFloor(config, -8174.25)

    expect(JSON.parse(JSON.stringify(config))).toEqual(snapshot)
  })

  it('пер-планетные ручки и прочие поля доезжают без изменений', () => {
    const adjusted = adjustAtmosphereForTerrainFloor(stubConfig(), -8174.25)

    expect(adjusted.exposure).toBe(4)
    expect(adjusted.hdrKnee).toBe(0.3)
    expect(adjusted.sunAngularRadius).toBe(0.004)
    expect(adjusted.groundAlbedo).toEqual([0.1, 0.1, 0.1])
    expect(adjusted.muSMin).toBe(-0.2)
  })
})

