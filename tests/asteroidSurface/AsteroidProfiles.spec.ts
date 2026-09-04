import { ASTEROID_PROFILES, type AsteroidProfileName, type AsteroidProfile } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'

const REQUIRED_KEYS: (keyof AsteroidProfile)[] = [
  'baseColor', 'colorJitter', 'tintStrength', 'mariaStrength',
  'surfaceAmbient', 'specularStrength', 'specularPower', 'specularTint',
  'freshnessBrighten', 'cavityShade'
]

describe('ASTEROID_PROFILES', () => {
  it('содержит четыре именованных профиля', () => {
    const names: AsteroidProfileName[] = ['stony', 'carbonaceous', 'metallic', 'icy']
    for (const n of names) {
      expect(ASTEROID_PROFILES[n]).toBeDefined()
    }
  })

  it('каждый профиль имеет полный набор полей контракта', () => {
    for (const profile of Object.values(ASTEROID_PROFILES)) {
      for (const key of REQUIRED_KEYS) {
        expect(typeof profile[key]).toBe('number')
      }
    }
  })

  it('профили различимы: металл блестит, углистый тёмный', () => {
    expect(ASTEROID_PROFILES.metallic.specularStrength).toBeGreaterThan(ASTEROID_PROFILES.stony.specularStrength)
    expect(ASTEROID_PROFILES.carbonaceous.baseColor).toBeLessThan(ASTEROID_PROFILES.icy.baseColor)
  })

  it('каждый профиль имеет morphologyWeights с суммой ≈ 1', () => {
    for (const profile of Object.values(ASTEROID_PROFILES)) {
      const w = profile.morphologyWeights
      expect(w).toBeDefined()
      for (const m of ['fragment', 'rubble', 'binary', 'top', 'cratered'] as const) {
        expect(typeof w[m]).toBe('number')
      }
      expect(w.fragment + w.rubble + w.binary + w.top + w.cratered).toBeCloseTo(1, 10)
    }
  })

  it('ожидаемые пропорции морфологий: осколок/rubble/двойная/волчок/кратерный', () => {
    expect(ASTEROID_PROFILES.stony.morphologyWeights).toEqual({ fragment: 0.5, rubble: 0.2, binary: 0.1, top: 0.05, cratered: 0.15 })
    expect(ASTEROID_PROFILES.carbonaceous.morphologyWeights).toEqual({ fragment: 0.4, rubble: 0.3, binary: 0.1, top: 0.05, cratered: 0.15 })
    // Металл держит монолит, волчков из слипшегося щебня не образует
    expect(ASTEROID_PROFILES.metallic.morphologyWeights).toEqual({ fragment: 0.65, rubble: 0.1, binary: 0.1, top: 0, cratered: 0.15 })
    expect(ASTEROID_PROFILES.icy.morphologyWeights).toEqual({ fragment: 0.6, rubble: 0.15, binary: 0.1, top: 0.05, cratered: 0.1 })
  })

  it('freshnessBrighten и cavityShade по спеке (свежий скол/днища кратеров)', () => {
    expect(ASTEROID_PROFILES.stony.freshnessBrighten).toBe(0.15)
    expect(ASTEROID_PROFILES.carbonaceous.freshnessBrighten).toBe(0.1)
    expect(ASTEROID_PROFILES.metallic.freshnessBrighten).toBe(0.2)
    expect(ASTEROID_PROFILES.icy.freshnessBrighten).toBe(0.3)

    expect(ASTEROID_PROFILES.stony.cavityShade).toBe(0.5)
    expect(ASTEROID_PROFILES.carbonaceous.cavityShade).toBe(0.5)
    expect(ASTEROID_PROFILES.metallic.cavityShade).toBe(0.5)
    expect(ASTEROID_PROFILES.icy.cavityShade).toBe(0.35)
  })

  it('detailSet: пер-профильный PBR-сет (фактура породы), icy — ледяной', () => {
    expect(ASTEROID_PROFILES.stony.detailSet).toBe('rock_boulder_dry')
    expect(ASTEROID_PROFILES.carbonaceous.detailSet).toBe('rock_boulder_dry')
    expect(ASTEROID_PROFILES.metallic.detailSet).toBe('rock_boulder_dry')
    expect(ASTEROID_PROFILES.icy.detailSet).toBe('rocks_ground_04')
  })
})
