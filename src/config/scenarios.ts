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
  },
  {
    id: 2,
    rootId: 42,
    name: 'Sagittarius A* system',
    description: 'Test demo of Supermassive black hole with some nearest objects',
    preview: 'SgrASystem.jpg',
    skybox: [1, 2, 3, 4, 5, 6],
    defaultCameraPosition: [0, fromAstronomicalUnits(1), fromAstronomicalUnits(1)],
    lightSources: [43]
  },
  {
    id: 3,
    rootId: 55,
    name: 'TOI-519 system',
    description: 'System with distant red-dwarf star and its satellite as hot-neptune',
    preview: 'TOI519System.jpg',
    skybox: [1, 2, 3, 4, 5, 6],
    defaultCameraPosition: [0, fromAstronomicalUnits(0.02), fromAstronomicalUnits(0.02)],
    lightSources: [56]
  },
  {
    id: 4,
    rootId: 59,
    name: 'Tatoo system',
    description: 'Approximate Tatoo system from Star Wars Universe',
    preview: 'TatooSystem.jpg',
    skybox: [1, 2, 3, 4, 5, 6],
    defaultCameraPosition: [0, fromAstronomicalUnits(1.2), fromAstronomicalUnits(1.2)],
    lightSources: [60, 61]
  },
  {
    id: 5,
    rootId: 80,
    name: 'Yavin system',
    description: 'Approximate Yavin system from Star Wars Universe',
    preview: 'unknown.png',
    skybox: [1, 2, 3, 4, 5, 6],
    defaultCameraPosition: [0, fromAstronomicalUnits(1.2), fromAstronomicalUnits(1.2)],
    lightSources: [81]
  },
  {
    id: 6,
    rootId: 86,
    name: 'Horuset system',
    description: 'Approximate system with ancient Sith world of Korriban',
    preview: 'unknown.png',
    skybox: [1, 2, 3, 4, 5, 6],
    defaultCameraPosition: [0, fromAstronomicalUnits(1.2), fromAstronomicalUnits(1.2)],
    lightSources: [87]
  },
  {
    id: 7,
    rootId: 101,
    name: 'Luhman 16 system',
    description: 'Closest brown dwarf binary: L7.5 and T0.5 components',
    preview: 'unknown.png',
    skybox: [1, 2, 3, 4, 5, 6],
    defaultCameraPosition: [0, fromAstronomicalUnits(3), fromAstronomicalUnits(3)],
    lightSources: [102, 103]
  },
  {
    id: 8,
    rootId: 104,
    name: 'Sirius system',
    description: 'Brightest star of the night sky and its white dwarf companion: a body the size of Earth beside an A1V giant',
    preview: 'unknown.png',
    skybox: [1, 2, 3, 4, 5, 6],
    // 25 а.е. охватывают всю орбиту (большая полуось пары — 19.8 а.е.).
    // Диск Сириуса B при этом много мельче пикселя: масштабный контраст
    // в двести раз и есть то, ради чего сцена заведена
    defaultCameraPosition: [0, fromAstronomicalUnits(25), fromAstronomicalUnits(25)],
    lightSources: [105, 106]
  },
  {
    id: 9,
    rootId: 107,
    name: 'Helix Nebula system',
    description: 'Closest bright planetary nebula and the white dwarf that lit it: a shell 1.7 ly across around a body the size of Earth',
    preview: 'unknown.png',
    skybox: [1, 2, 3, 4, 5, 6],
    // Полуразмер туманности — 53 629 а.е.; с 127 000 а.е. оболочка помещается
    // в кадр целиком. Сам карлик оттуда невидим: его диск дорастает до порога
    // импостора лишь примерно с 0.02 а.е., то есть в шесть миллионов раз ближе.
    // Этот разрыв масштабов и есть сцена — к звезде летят навигацией
    defaultCameraPosition: [0, fromAstronomicalUnits(90000), fromAstronomicalUnits(90000)],
    lightSources: [108]
  }
]
