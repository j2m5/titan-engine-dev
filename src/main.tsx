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
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'
import { Command } from '@/core/framework/commands/Command'
import { Actor } from '@/core/models/Actor'

async function bootstrap(): Promise<void> {
  const container: Container = new Kernel([
    AppServiceProvider
    // other providers here
  ]).bootstrap()

  Command.useContainer(container)

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

console.log(Actor.find(11))
