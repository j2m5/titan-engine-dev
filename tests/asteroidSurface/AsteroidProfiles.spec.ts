import { ASTEROID_PROFILES, type AsteroidProfileName, type AsteroidProfile } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'

const REQUIRED_KEYS: (keyof AsteroidProfile)[] = [
  'baseColor', 'colorJitter', 'tintStrength', 'mariaStrength',
  'surfaceAmbient', 'specularStrength', 'specularPower', 'specularTint'
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
})
