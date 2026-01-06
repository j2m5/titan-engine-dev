import './styles/App.scss'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/ui/App'
import { InversifyProvider } from '@/ui/inversify-react'
import { engineStore } from '@/ui/mobX/EngineStore'
import { Application } from '@/Application'
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'
import { Container } from 'inversify'
import { Resource } from '@/core/models/Resource'
import { Collection } from '@/core/framework/support/Collection'
import { Actor } from '@/core/models/Actor'
import { ModelCollection } from '@/core/framework/Memoquent/ModelCollection'

const provider: AppServiceProvider = new AppServiceProvider()
provider.register()

export const container: Container = provider.container

async function bootstrap(): Promise<void> {
  const app: Application = provider.container.get<Application>('Application')

  await engineStore.initialize(app)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <InversifyProvider container={provider.container}>
        <App />
      </InversifyProvider>
    </StrictMode>
  )
}

await bootstrap()

const list: string[] = ['sun_glow.png', 'star.png', 'asteroid.jpg', 'night.jpg']

const required = Resource.all().whereIn('path', list).toJSON()
console.log(required)

console.log(Resource.all().last())

const a = [
  {
    id: 1,
    name: 'sdsad',
    alias: 'alias'
  },
  {
    id: 2,
    name: 'kjgfkjhgk',
    alias: 'alias'
  },
  {
    id: 1,
    name: 'iureitui',
    alias: 'alias'
  },
  {
    id: 5,
    name: 'gkjgkjh',
    alias: 'alias'
  },
  {
    id: 1,
    name: 'wiweuiewu',
    alias: 'alias'
  },
  {
    id: 5,
    name: 'nvcmnbmvn',
    alias: 'alias'
  },
  {
    id: null,
    name: 'kfbgfghgh',
    alias: 'alias'
  }
]

const actors = Actor.all()
console.log(actors)

const actor = actors.find(7)!
const actor2 = actors.find(7)!
const actor3 = actors.find(7)!
const actor4 = actors.find(8)!
const actor5 = actors.find(8)!
const actors2 = ModelCollection.make([actor, actor2, actor3, actor4, actor5])
console.log(actors.chunk(10))
console.log('-----', actors2)
console.log('-----', actors2.unique('id'))
console.log(actor)
console.log(actors.whereIn('id', [7, 8, 10]))
console.log(actors.count())
console.log(actors.last())
console.log(actors.pluck('name'))
console.log(actors.map((item) => item.attributes.color))

const test = Collection.make(a)
console.log(test.every('alias', '===', 'alias'))
console.log(test.some('id', '===', 4))
console.log('groupby', test.groupBy('id'))
console.log('keyby', test.keyBy('id'))
console.log(test.sum('id'))
console.log(test.avg('id'))
console.log(test.min('id'))
console.log(test.max('id'))
console.log(test.sortBy('id'))
console.log(test.unique('id'))
console.log(test.whereNotNull('id').whereNotBetween('id', [0, 3]))
console.log(test.pluck('id'))
console.log('sdsdsdsdd', Actor.query().where({ id: 7 }).get())
