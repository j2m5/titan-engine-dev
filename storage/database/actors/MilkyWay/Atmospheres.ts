import { IActor } from '@/core/models/types'
import { SolarSystemAtmospheres } from '@storage/database/actors/MilkyWay/SolarSystem/Atmospheres'

const TOI519Atmospheres: IActor[] = [
  {
    id: 71,
    categoryId: 8,
    parentId: 22,
    name: 'TOI-519b',
    description: '',
    color: '#ffffff'
  }
]

const SolarAtmospheres: IActor[] = [...SolarSystemAtmospheres]

export const Atmospheres: IActor[] = [...TOI519Atmospheres, ...SolarAtmospheres]
