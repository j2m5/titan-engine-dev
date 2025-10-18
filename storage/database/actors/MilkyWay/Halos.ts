import { IActor } from '@/core/models/types'

const SolarHalos: IActor[] = [
  {
    id: 83,
    categoryId: 9,
    parentId: 63,
    name: 'Triton',
    description: '',
    color: '#ffffff'
  },
  {
    id: 84,
    categoryId: 9,
    parentId: 41,
    name: 'Pluto',
    description: '',
    color: '#ffffff'
  },
  {
    id: 85,
    categoryId: 9,
    parentId: 44,
    name: 'Eris',
    description: '',
    color: '#ffffff'
  }
]

export const Halos: IActor[] = [...SolarHalos]
