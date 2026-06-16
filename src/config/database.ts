import {
  Actors,
  Categories,
  Orbits,
  PhysicalObjects,
  Placements,
  RenderingObjects,
  Resources,
  RotationObjects,
  ActorResource
} from '@storage/database'

const database: Map<string, unknown> = new Map()
database.set('categories', Categories)
database.set('actors', Actors)
database.set('physicalObjects', PhysicalObjects)
database.set('renderingObjects', RenderingObjects)
database.set('orbits', Orbits)
database.set('rotationObjects', RotationObjects)
database.set('placements', Placements)
database.set('resources', Resources)
database.set('actorResource', ActorResource)

export { database }
