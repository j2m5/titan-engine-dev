import { ResourceTypes, ResourceLifecycles } from '@/core/models/types'
import { shortenResourcePath } from '@/ui/editor/forms/shortenResourcePath'
import { TableSpec } from '@/ui/editor/forms/fieldSpec'

const resourceTypeOptions = (Object.keys(ResourceTypes) as string[])
  .filter((k) => isNaN(Number(k)))
  .map((t) => ({ value: t, label: t }))

const lifecycleOptions = (Object.keys(ResourceLifecycles) as string[])
  .filter((k) => isNaN(Number(k)))
  .map((l) => ({ value: l, label: l }))

export const resourcesSpec: TableSpec = {
  table: 'resources',
  title: 'Resources',
  fields: [
    { key: 'id', label: 'ID', kind: 'number', readonly: true },
    { key: 'resourceType', label: 'Type', kind: 'select-enum', options: resourceTypeOptions },
    { key: 'lifecycle', label: 'Lifecycle', kind: 'select-enum', options: lifecycleOptions },
    { key: 'path', label: 'Path', kind: 'text', full: true },
    { key: 'lifetime', label: 'Lifetime (ms, 0 = infinite)', kind: 'number', step: 1000 },
    { key: 'colorSpace', label: 'Color space', kind: 'text' }
  ],
  // в списке показываем тип + усечённый путь
  listLabel: (row) => `#${row.id} [${row.resourceType}] ${shortenResourcePath(String(row.path ?? ''))}`,
  defaults: () => ({
    resourceType: 'diffuse',
    lifecycle: 'streamable',
    path: '',
    lifetime: 60000
  })
}

export const actorResourceSpec: TableSpec = {
  table: 'actorResource',
  title: 'Actor Resources',
  fields: [
    { key: 'id', label: 'ID', kind: 'number', readonly: true },
    { key: 'actorId', label: 'Actor', kind: 'select-fk', references: 'actors', optionLabel: 'actorName', full: true },
    {
      key: 'resourceId',
      label: 'Resource',
      kind: 'select-fk',
      references: 'resources',
      optionLabel: 'resourcePath',
      full: true
    }
  ],
  // 'Earth → …/earth/earth.jpg'
  listLabel: (row, ctx) => {
    const actorName = ctx.actorName(row.actorId as number)
    const path = ctx.resourcePath ? ctx.resourcePath(row.resourceId as number) : `#${row.resourceId}`
    return `${actorName} → ${path}`
  },
  defaults: () => ({ actorId: null, resourceId: null })
}
