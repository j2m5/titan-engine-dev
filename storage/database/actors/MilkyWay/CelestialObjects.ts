import { IActor } from '@/core/models/types'
import { SolarSystemCelestialObjects } from './SolarSystem/CelestialObjects'

const TOI519CelestialObjects: IActor[] = [
  {
    id: 21,
    categoryId: 6,
    parentId: 20,
    name: 'TOI-519',
    description: '',
    color: '#ef3535'
  },
  {
    id: 22,
    categoryId: 7,
    parentId: 21,
    name: 'TOI-519b',
    description: '',
    color: '#2e78da'
  }
]

const SgrAObjects: IActor[] = [
  {
    id: 94,
    categoryId: 5,
    parentId: 93,
    name: 'Sgr A*',
    description: '',
    color: '#ffffff'
  },
  {
    id: 95,
    categoryId: 7,
    parentId: 94,
    name: 'Sgr A* I',
    description: '',
    color: '#2e78da'
  }
]

const SolarCelestialObjects: IActor[] = [...SolarSystemCelestialObjects]

export const CelestialObjects: IActor[] = [...TOI519CelestialObjects, ...SolarCelestialObjects, ...SgrAObjects]
