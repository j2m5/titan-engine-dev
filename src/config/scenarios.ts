export type ScenarioConfig = {
  id: number
  actorId: number
  name: string
  description: string
  preview: string
}

export const Scenarios: ScenarioConfig[] = [
  {
    id: 1,
    actorId: 19,
    name: 'Milky Way',
    description: '',
    preview: 'unknown.png'
  },
  {
    id: 2,
    actorId: 1,
    name: 'Star Wars Galaxy',
    description: '',
    preview: 'unknown.png'
  }
]
