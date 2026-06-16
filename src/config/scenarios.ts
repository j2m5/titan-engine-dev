import { fromAstronomicalUnits } from '@/core/helpers/scaling'

export type ScenarioConfig = {
  id: number
  rootId: number
  name: string
  description: string
  preview: string
  skybox: number[]
  defaultCameraPosition: [number, number, number]
  lightSources: number[]
}

export const Scenarios: ScenarioConfig[] = [
  {
    id: 1,
    rootId: 1,
    name: 'Solar system',
    description: 'Solar system',
    preview: 'SolarSystem.jpg',
    skybox: [1, 2, 3, 4, 5, 6],
    defaultCameraPosition: [0, fromAstronomicalUnits(2), fromAstronomicalUnits(2)],
    lightSources: [4]
  }
  /*{
    id: 1,
    rootId: 86,
    name: 'Solar system',
    description: 'Solar system',
    preview: 'SolarSystem.jpg',
    skybox: [94, 95, 96, 97, 98, 99],
    defaultCameraPosition: [0, fromAstronomicalUnits(2), fromAstronomicalUnits(2)],
    lightSources: [31]
  },
  {
    id: 2,
    rootId: 20,
    name: 'TOI-519 system',
    description: 'System with distant red-dwarf star and its satellite as hot-neptune',
    preview: 'TOI519System.jpg',
    skybox: [94, 95, 96, 97, 98, 99],
    defaultCameraPosition: [0, fromAstronomicalUnits(0.02), fromAstronomicalUnits(0.02)],
    lightSources: [21]
  },
  {
    id: 3,
    rootId: 2,
    name: 'Tatoo system',
    description: 'Approximate Tatoo system from Star Wars Universe',
    preview: 'TatooSystem.jpg',
    skybox: [94, 95, 96, 97, 98, 99],
    defaultCameraPosition: [0, fromAstronomicalUnits(1.2), fromAstronomicalUnits(1.2)],
    lightSources: [4, 5]
  },
  {
    id: 4,
    rootId: 87,
    name: 'Yavin system',
    description: 'Approximate Yavin system from Star Wars Universe',
    preview: 'unknown.png',
    skybox: [94, 95, 96, 97, 98, 99],
    defaultCameraPosition: [0, fromAstronomicalUnits(1.2), fromAstronomicalUnits(1.2)],
    lightSources: [88]
  },
  {
    id: 5,
    rootId: 93,
    name: 'Sagittarius A* system',
    description: 'Test demo of Supermassive black hole with some nearest objects',
    preview: 'SgrASystem.jpg',
    skybox: [94, 95, 96, 97, 98, 99],
    defaultCameraPosition: [0, fromAstronomicalUnits(1), fromAstronomicalUnits(1)],
    lightSources: [93]
  }*/
]
