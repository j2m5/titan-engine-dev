import { Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import type { ObservableRecord } from '@/core/services/SceneObserver'

/** Resolve the physical body in shipped fixtures, excluding its named atmosphere/ring. */
export function observedActor(name: string): Actor {
  const actor = Actor.all().toArray().find((candidate) => candidate.getAttribute('name') === name && candidate.physicalObject !== null)
  if (!actor) throw new Error(`Missing observed actor fixture: ${name}`)
  return actor
}

export function observedRecord(name: string, distance: number): ObservableRecord {
  return { actorId: observedActor(name).getAttribute('id')!, name, distance, position: new Vector3() }
}
