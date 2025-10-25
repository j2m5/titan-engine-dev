import './styles/App.scss'
import container from '@/core/framework/DI/container'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/ui/App'
import { InversifyProvider } from '@/ui/inversify-react'
import DIServices from '@/core/framework/DI/DIServices'
import { engineStore } from '@/ui/mobX/EngineStore'
import { Application } from '@/Application'

async function bootstrap(): Promise<void> {
  const app: Application = container.get<Application>(DIServices.Application)

  await engineStore.initialize(app)

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <InversifyProvider container={container}>
        <App />
      </InversifyProvider>
    </StrictMode>
  )
}

await bootstrap()
