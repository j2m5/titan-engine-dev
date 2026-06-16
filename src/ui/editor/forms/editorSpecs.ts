import { orbitsSpec, physicalObjectsSpec, rotationObjectsSpec, placementsSpec } from '@/ui/editor/forms/tableSpecs'
import { categoriesSpec, actorsSpec, renderingObjectsSpec } from '@/ui/editor/forms/namedSpecs'
import { TableSpec } from '@/ui/editor/forms/fieldSpec'
import { actorResourceSpec, resourcesSpec } from '@/ui/editor/forms/resourceSpecs'

export const editorSpecs: TableSpec[] = [
  actorsSpec,
  categoriesSpec,
  orbitsSpec,
  physicalObjectsSpec,
  renderingObjectsSpec,
  rotationObjectsSpec,
  placementsSpec,
  resourcesSpec,
  actorResourceSpec
]

export const specByTable: Record<string, TableSpec> = Object.fromEntries(editorSpecs.map((s) => [s.table, s]))
