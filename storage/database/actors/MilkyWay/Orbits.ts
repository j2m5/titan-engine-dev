import { IOrbit } from '@/core/models/types'
import { SolarSystemOrbits } from './SolarSystem/Orbits'

const TOI519Orbits: IOrbit[] = [
  {
    id: 16,
    actorId: 22,
    semiMajorAxis: 0.0159,
    eccentricity: 0.35,
    inclination: 0.2,
    argOfPeriapsis: 41.168,
    ascendingNode: 125.452,
    meanAnomalyAtEpoch: 127.276
  }
]

const TestBlackHoleOrbits: IOrbit[] = [
  {
    id: 3000,
    actorId: 2001,
    semiMajorAxis: 2.0159,
    eccentricity: 0.35,
    inclination: 10.8,
    argOfPeriapsis: 41.168,
    ascendingNode: 125.452,
    meanAnomalyAtEpoch: 27.276
  }
]

const SolarOrbits: IOrbit[] = [...SolarSystemOrbits]

export const Orbits: IOrbit[] = [...TOI519Orbits, ...SolarOrbits, ...TestBlackHoleOrbits]
