import { orbitsSpec, physicalObjectsSpec, rotationObjectsSpec, placementsSpec } from '@/ui/editor/forms/tableSpecs'
import { categoriesSpec, actorsSpec } from '@/ui/editor/forms/namedSpecs'
import { TableSpec } from '@/ui/editor/forms/fieldSpec'

export const editorSpecs: TableSpec[] = [
  actorsSpec,
  categoriesSpec,
  orbitsSpec,
  physicalObjectsSpec,
  rotationObjectsSpec,
  placementsSpec
]

export const specByTable: Record<string, TableSpec> = Object.fromEntries(editorSpecs.map((s) => [s.table, s]))
