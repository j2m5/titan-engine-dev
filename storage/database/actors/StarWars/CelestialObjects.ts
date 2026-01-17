import { IActor } from '@/core/models/types'

const TatooCelestialObjects: IActor[] = [
  {
    id: 4,
    categoryId: 6,
    parentId: 3,
    name: 'Tatoo I',
    description: '',
    color: '#e5e55a'
  },
  {
    id: 5,
    categoryId: 6,
    parentId: 3,
    name: 'Tatoo II',
    description: '',
    color: '#ea9650'
  },
  {
    id: 6,
    categoryId: 7,
    parentId: 3,
    name: 'Tatooine',
    description: '',
    color: '#cd853f'
  },
  {
    id: 7,
    categoryId: 7,
    parentId: 3,
    name: 'Ohann',
    description: '',
    color: '#d7bb5f'
  },
  {
    id: 8,
    categoryId: 7,
    parentId: 3,
    name: 'Adriana',
    description: '',
    color: '#2f9ece'
  },
  {
    id: 9,
    categoryId: 7,
    parentId: 6,
    name: 'Ghomrassen',
    description: '',
    color: '#888684'
  },
  {
    id: 10,
    categoryId: 7,
    parentId: 6,
    name: 'Guermessa',
    description: '',
    color: '#83684c'
  },
  {
    id: 11,
    categoryId: 7,
    parentId: 6,
    name: 'Chenini',
    description: '',
    color: '#888787'
  },
  {
    id: 12,
    categoryId: 7,
    parentId: 7,
    name: 'Ohann I',
    description: '',
    color: '#b4b4b4'
  },
  {
    id: 13,
    categoryId: 7,
    parentId: 7,
    name: 'Ohann II',
    description: '',
    color: '#b4b4b4'
  },
  {
    id: 14,
    categoryId: 7,
    parentId: 7,
    name: 'Ohann III',
    description: '',
    color: '#b4b4b4'
  },
  {
    id: 15,
    categoryId: 7,
    parentId: 8,
    name: 'Adriana I',
    description: '',
    color: '#b4b4b4'
  },
  {
    id: 16,
    categoryId: 7,
    parentId: 8,
    name: 'Adriana II',
    description: '',
    color: '#b4b4b4'
  },
  {
    id: 17,
    categoryId: 7,
    parentId: 8,
    name: 'Adriana III',
    description: '',
    color: '#b4b4b4'
  },
  {
    id: 18,
    categoryId: 7,
    parentId: 8,
    name: 'Adriana IV',
    description: '',
    color: '#b4b4b4'
  }
]

const YavinCelestialObjects: IActor[] = [
  {
    id: 88,
    categoryId: 6,
    parentId: 87,
    name: 'Yavin',
    description: '',
    color: '#de8623'
  },
  {
    id: 89,
    categoryId: 7,
    parentId: 88,
    name: 'Yavin Prime',
    description: '',
    color: '#ea4123'
  },
  {
    id: 91,
    categoryId: 7,
    parentId: 89,
    name: 'Yavin IV',
    description: '',
    color: '#178f28'
  }
]

export const CelestialObjects: IActor[] = [...TatooCelestialObjects, ...YavinCelestialObjects]
