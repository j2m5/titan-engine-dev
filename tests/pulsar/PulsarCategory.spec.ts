import { describe, it, expect } from 'vitest'
import { Categories } from '@storage/database'
import { AllowedCategories } from '@/core/models/types'
import { OBSERVED_TYPES } from '@/core/services/SceneObserver'
import { renderingDataTemplates } from '@/ui/editor/forms/dataTemplates'
import { config } from '@/core/framework/config'
import { validateDatabase, DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'

describe('категория пульсара', () => {
  it('заведена в таблице под id 12', () => {
    const category = Categories.find((c) => c.alias === 'pulsar')

    expect(category).toBeDefined()
    expect(category!.id).toBe(12)
  })

  it('объявлена в AllowedCategories и наблюдаема (маркер навигации, как белый карлик)', () => {
    expect(Object.keys(AllowedCategories)).toContain('pulsar')
    expect(OBSERVED_TYPES).toContain('pulsar')
  })

  it('имеет заготовку renderingObject.data в редакторе с полным набором ручек', () => {
    const template = renderingDataTemplates.find((t) => t.value === 'pulsar')

    expect(template).toBeDefined()
    expect(Object.keys(template!.data as object)).toEqual([
      'exposureBias',
      'beamPeriodSeconds',
      'beamTiltDeg',
      'beamHalfAngleDeg',
      'beamLengthAu',
      'beamColor',
      'beamIntensity',
      'beamPhaseDeg'
    ])
  })

  it('конфиг гало и LOD — дефолты белого карлика', () => {
    expect(config('pulsar.haloScale')).toBe(0.45)
    expect(config('pulsar.haloOpacity')).toBe(0.05)
    expect(config('pulsar.lodHysteresis')).toBe(0.05)
  })

  it('валидатор: пульсар — центральное тело (физика + rendering, без орбиты), placements для него — ошибка', () => {
    const db: DatabaseSnapshot = {
      categories: [
        { id: 1, alias: 'barycenter', name: 'Barycenter' },
        { id: 12, alias: 'pulsar', name: 'Pulsar' }
      ],
      actors: [
        { id: 1, categoryId: 1, parentId: null, name: 'Root', description: '', color: '#fff' },
        { id: 2, categoryId: 12, parentId: 1, name: 'PSR', description: '', color: '#fff' }
      ],
      orbits: [],
      rotationObjects: [],
      physicalObjects: [
        { id: 1, actorId: 2, parentId: null, mass: 2.8e30, radius: 10, axialTilt: 0, orbitalPeriod: 1, rotationPeriod: 1, temperature: 1e6 }
      ],
      renderingObjects: [{ id: 1, actorId: 2, data: { exposureBias: 1 } }],
      placements: [{ id: 1, actorId: 2, x: 1, y: 0, z: 0 }],
      resources: [],
      actorResource: []
    }

    const errors = validateDatabase(db).errors
    expect(errors.some((e) => e.collection === 'placements' && /pulsar/.test(e.message))).toBe(true)
  })
})
