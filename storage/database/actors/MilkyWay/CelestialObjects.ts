import { IActor } from '@/core/models/types'
import { SolarSystemCelestialObjects } from './SolarSystem/CelestialObjects.ts'

const TOI519CelestialObjects: IActor[] = [
  {
    id: 21,
    categoryId: 5,
    parentId: 20,
    name: 'test bh', // TOI-519
    description: '',
    color: '#ef3535'
  },
  {
    id: 22,
    categoryId: 7,
    parentId: 21,
    name: 'test bh satellite', // TOI-519b
    description: '',
    color: '#2e78da'
  }
]

const SolarCelestialObjects: IActor[] = [...SolarSystemCelestialObjects]

export const CelestialObjects: IActor[] = [...TOI519CelestialObjects, ...SolarCelestialObjects]
