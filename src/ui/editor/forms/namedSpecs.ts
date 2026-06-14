import { TableSpec } from '@/ui/editor/forms/fieldSpec'
import { AllowedCategories } from '@/core/models/types'

const idField = { key: 'id', label: 'ID', kind: 'number' as const, readonly: true }

/** опции алиаса категории из enum AllowedCategories (string-ключи) */
const categoryAliasOptions = (Object.keys(AllowedCategories) as string[])
  .filter((k) => isNaN(Number(k))) // только строковые ключи enum
  .map((alias) => ({ value: alias, label: alias }))

export const categoriesSpec: TableSpec = {
  table: 'categories',
  title: 'Categories',
  fields: [
    idField,
    {
      key: 'alias',
      label: 'Alias',
      kind: 'select-enum',
      options: categoryAliasOptions
    },
    { key: 'name', label: 'Name', kind: 'text', full: true }
  ],
  listLabel: (row) => `#${row.id} ${row.name ?? row.alias ?? ''}`,
  defaults: () => ({ alias: 'planet', name: 'New Category' })
}

export const actorsSpec: TableSpec = {
  table: 'actors',
  title: 'Actors',
  fields: [
    idField,
    {
      key: 'categoryId',
      label: 'Category',
      kind: 'select-fk',
      references: 'categories'
    },
    {
      key: 'parentId',
      label: 'Parent',
      kind: 'select-fk',
      references: 'actors',
      nullable: true,
      excludeSelf: true,
      full: true
    },
    { key: 'name', label: 'Name', kind: 'text', full: true },
    { key: 'description', label: 'Description', kind: 'textarea', full: true },
    { key: 'color', label: 'Color', kind: 'color' }
  ],
  listLabel: (row) => `#${row.id} ${row.name ?? ''}`,
  defaults: () => ({
    categoryId: null,
    parentId: null,
    name: 'New Actor',
    description: '',
    color: '#ffffff'
  })
}

export const renderingObjectsSpec: TableSpec = {
  table: 'renderingObjects',
  title: 'Rendering',
  fields: [
    { key: 'id', label: 'ID', kind: 'number', readonly: true },
    { key: 'actorId', label: 'Actor', kind: 'select-fk', references: 'actors', full: true },
    { key: 'data', label: 'Data (JSON)', kind: 'json', rows: 14, cloneFrom: true }
  ],
  listLabel: (row, ctx) => `#${row.id} → ${ctx.actorName(row.actorId as number)}`,
  defaults: () => ({ actorId: null, data: { emission: 1, bumpScale: 0 } })
}
