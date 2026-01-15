import './styles/App.scss'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Container } from 'inversify'
import App from '@/ui/App'
import { InversifyProvider } from '@/ui/inversify-react'
import { engineStore } from '@/ui/mobX/EngineStore'
import { Application } from '@/Application'
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'

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
