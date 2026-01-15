import './styles/App.scss'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Container } from 'inversify'
import App from '@/ui/App'
import { InversifyProvider } from '@/ui/inversify-react'
import { engineStore } from '@/ui/mobX/EngineStore'
import { Application } from '@/Application'
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'
import { Actor } from '@/core/models/Actor'
import { Resource } from '@/core/models/Resource'

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

const actors = Actor.query()
  /*.whereDoesntHave('resources', (items) => {
    return items.where('resourceType', 'bump')
  })*/
  //.whereIn('categoryId', [2, 3])
  //.whereNotNull('parentId')
  .whereNotBetween('id', [10, 15])
  .get()

console.log(11111, actors)
console.log('232323', Actor.query().get())

console.log(Resource.first())

console.log(Actor.query().get())
