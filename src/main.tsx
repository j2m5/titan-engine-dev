import './styles/App.scss'
import './core/framework/TitanThree'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/ui/App'
import { DiProvider } from '@/ui/di-react'
import { engineStore } from '@/ui/mobx/EngineStore'
import { Container } from '@/core/framework/container/Container'
import { Kernel } from '@/core/framework/container/Kernel'
import { Tokens } from '@/core/providers/tokens'
import { RenderingServiceProvider } from '@/core/providers/RenderingServiceProvider'
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'
import { UiServiceProvider } from '@/ui/providers/UiServiceProvider'
import { Command } from '@/core/framework/commands/Command'

async function bootstrap(): Promise<void> {
  const container: Container = new Kernel([
    RenderingServiceProvider,
    AppServiceProvider,
    UiServiceProvider
  ]).bootstrap()

  Command.bindContainer(container)

  // Дебаг-сцена атмосферы: ?atmoDebug=<actorId> вместо приложения.
  // Модели ORM живут со статических импортов — контейнера достаточно.
  const atmoDebugId = new URLSearchParams(location.search).get('atmoDebug')
  if (atmoDebugId) {
    const { AtmosphereDebugScene } = await import('@/core/renderables/Atmosphere/AtmosphereDebugScene')
    new AtmosphereDebugScene(document.body, Number(atmoDebugId))
    return
  }

  await engineStore.initialize(container.get(Tokens.Application))

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <DiProvider container={container}>
        <App />
      </DiProvider>
    </StrictMode>
  )
}

await bootstrap()
