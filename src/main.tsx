import './styles/App.scss'
import './core/framework/TitanThree'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Container } from 'inversify'
import App from '@/ui/App'
import { InversifyProvider } from '@/ui/inversify-react'
import { engineStore } from '@/ui/mobx/EngineStore'
import { Application } from '@/Application'
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'
import { Actor } from '@/core/models/Actor'
import { PhysicalObject } from '@/core/models/PhysicalObject'
import { Orbit } from '@/core/models/Orbit'
import { Resource } from '@/core/models/Resource'
import { RenderingObject } from '@/core/models/RenderingObject'

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

console.log(Actor.query().get().last())
console.log(Actor.query().orderBy('id').pluck('name'))
console.log(PhysicalObject.query().orderBy('id').get().toArray())
console.log(Orbit.query().orderBy('id').get().toArray())
console.log(Resource.query().orderBy('id').get().toArray())
console.log(RenderingObject.query().orderBy('id').get().toArray())
