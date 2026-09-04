import { archetypeLayout, morphologyForIndex, morphologyRanges } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ArchetypeLibrary'
import { ASTEROID_PROFILES } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidProfiles'
import { shapeModelManifestPaths } from '@/core/renderables/DetailedRingStreamingSystem/archetypes/shapeModelPaths'

describe('archetypeLayout: реальные модели в хвосте библиотеки, процедурные в голове', () => {
  it('stony K=14, доля реальных 0.5 → 7 процедурных + 7 реальных из списка профиля по кругу', () => {
    const layout = archetypeLayout('stony', 14)
    expect(layout.proceduralCount).toBe(7)
    expect(layout.realModels.length).toBe(7)
    const names = ASTEROID_PROFILES.stony.shapeModels
    // Список профиля циклически, если моделей меньше слотов
    for (let i = 0; i < layout.realModels.length; i++) {
      expect(layout.realModels[i]).toBe(names[i % names.length])
    }
  })

  it('без списка моделей (доля 0 или пустой список) вся библиотека процедурная', () => {
    expect(archetypeLayout('stony', 14, { shapeModels: [], realShare: 0.5 }).proceduralCount).toBe(14)
    expect(archetypeLayout('stony', 14, { shapeModels: ['x'], realShare: 0 }).proceduralCount).toBe(14)
  })

  it('процедурная голова раскладывается по морфологиям как библиотека размером proceduralCount, k=0 — осколок', () => {
    const layout = archetypeLayout('stony', 14)
    expect(morphologyForIndex('stony', 0, 14)).toBe('fragment')
    const ranges = morphologyRanges('stony', 14)
    const procedural = ranges.filter((r) => r.morphology !== 'real')
    const total = procedural.reduce((s, r) => s + r.count, 0)
    expect(total).toBe(layout.proceduralCount)
    // Реальный диапазон — хвост
    const real = ranges.find((r) => r.morphology === 'real')!
    expect(real.start).toBe(layout.proceduralCount)
    expect(real.count).toBe(layout.realModels.length)
    for (let k = real.start; k < 14; k++) expect(morphologyForIndex('stony', k, 14)).toBe('real')
  })

  it('K=1 — единственный слот остаётся процедурным осколком', () => {
    expect(archetypeLayout('stony', 1).proceduralCount).toBe(1)
    expect(morphologyForIndex('stony', 0, 1)).toBe('fragment')
  })
})

describe('shapeModelManifestPaths: пути бинарников для манифеста облака', () => {
  it('оба яруса каждой модели каждого профиля, уникально и отсортировано', () => {
    const paths = shapeModelManifestPaths()
    for (const profile of Object.values(ASTEROID_PROFILES)) {
      for (const name of profile.shapeModels) {
        expect(paths).toContain(`asteroids/shapes/${name}_l0.bin`)
        expect(paths).toContain(`asteroids/shapes/${name}_near.bin`)
      }
    }
    expect(new Set(paths).size).toBe(paths.length)
    expect([...paths].sort()).toEqual(paths)
  })
})
