import { describe, it, expect } from 'vitest'
import { renderingDataTemplates } from '@/ui/editor/forms/dataTemplates'
import { renderingObjectsSpec } from '@/ui/editor/forms/namedSpecs'
import { DatabaseSnapshot, validateDatabase } from '@/core/framework/validation/validateDatabase'
import { nebulaParamsFromData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { INebulaRenderingObject } from '@/core/models/types'
import { JsonFieldSpec } from '@/ui/editor/forms/fieldSpec'

const templateFor = (value: string): unknown => renderingDataTemplates.find((t) => t.value === value)?.data

/**
 * Снимок с актором нужной категории и строкой рендеринга из шаблона.
 * Родительская планета получает радиус, равный bottomRadius атмосферы:
 * якорь атмосферы валидатор проверяет отдельно.
 */
function snapshotWithTemplate(alias: string, categoryId: number, data: unknown): DatabaseSnapshot {
  const bottomRadius = (data as { bottomRadius?: number }).bottomRadius ?? 6360

  return {
    // categoryId у вызывающих — 5, 6, 7; с 1 и 2 не пересекается
    categories: [
      { id: 1, alias: 'barycenter', name: 'Barycenter' },
      { id: 2, alias: 'planet', name: 'Planet' },
      { id: categoryId, alias: alias as never, name: alias }
    ],
    actors: [
      { id: 10, categoryId: 1, parentId: null, name: 'Root', description: '', color: '#fff' },
      { id: 11, categoryId: 2, parentId: 10, name: 'Host', description: '', color: '#fff' },
      { id: 12, categoryId, parentId: 11, name: 'Subject', description: '', color: '#fff' }
    ],
    orbits: [],
    rotationObjects: [],
    physicalObjects: [
      {
        id: 1,
        actorId: 11,
        parentId: null,
        mass: 1,
        radius: bottomRadius,
        axialTilt: 0,
        orbitalPeriod: 1,
        rotationPeriod: 1,
        temperature: 0
      }
    ],
    renderingObjects: [{ id: 1, actorId: 12, data: data as Record<string, unknown> }],
    placements: [],
    resources: [],
    actorResource: []
  }
}

describe('шаблоны data редактора', () => {
  it('покрывают все категории с конфигом рендеринга', () => {
    expect(renderingDataTemplates.map((t) => t.value).sort()).toEqual(
      ['atmosphere', 'nebula', 'planet', 'ring'].sort()
    )
  })

  it('подключены к форме Rendering', () => {
    const dataField = renderingObjectsSpec.fields.find((f) => f.key === 'data') as JsonFieldSpec

    expect(dataField.kind).toBe('json')
    expect(dataField.templates).toBe(renderingDataTemplates)
  })

  const cases: Array<[string, number]> = [
    ['nebula', 7],
    ['atmosphere', 5],
    ['ring', 6]
  ]

  it.each(cases)('шаблон %s проходит валидатор без ошибок', (alias, categoryId) => {
    const result = validateDatabase(snapshotWithTemplate(alias, categoryId, templateFor(alias)))

    expect(result.errors).toEqual([])
  })

  it('шаблон туманности собирается в параметры движка', () => {
    const params = nebulaParamsFromData(templateFor('nebula') as INebulaRenderingObject)

    expect(params.size).toBeGreaterThan(0)
    expect(params.palette.stops.length).toBeGreaterThan(0)
  })
})
