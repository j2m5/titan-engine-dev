import './styles/App.scss'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/ui/App'
import { InversifyProvider } from '@/ui/inversify-react'
import { engineStore } from '@/ui/mobX/EngineStore'
import { Application } from '@/Application'
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'
import { Container } from 'inversify'
import { GraphicServiceProvider } from '@/core/framework/services/GraphicServiceProvider'

const provider: AppServiceProvider = new AppServiceProvider()
provider.register()

const graphicProvider: GraphicServiceProvider = new GraphicServiceProvider()
graphicProvider.register()

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
