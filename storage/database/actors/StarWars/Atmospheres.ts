import { IActor } from '@/core/models/types'

const TatooAtmospheres: IActor[] = [
  {
    id: 66,
    categoryId: 8,
    parentId: 6,
    name: 'Tatooine',
    description: '',
    color: '#ffffff'
  },
  {
    id: 67,
    categoryId: 8,
    parentId: 7,
    name: 'Ohann',
    description: '',
    color: '#ffffff'
  },
  {
    id: 68,
    categoryId: 8,
    parentId: 8,
    name: 'Adriana',
    description: '',
    color: '#ffffff'
  },
  {
    id: 69,
    categoryId: 8,
    parentId: 17,
    name: 'Adriana III',
    description: '',
    color: '#ffffff'
  }
]

const YavinAtmospheres: IActor[] = [
  {
    id: 90,
    categoryId: 8,
    parentId: 89,
    name: 'Yavin Prime',
    description: '',
    color: '#ffffff'
  },
  {
    id: 92,
    categoryId: 8,
    parentId: 91,
    name: 'Yavin IV',
    description: '',
    color: '#ffffff'
  }
]

export const Atmospheres: IActor[] = [...TatooAtmospheres, ...YavinAtmospheres]
