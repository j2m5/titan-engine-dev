import '@/core/framework/TitanThree'
import type { ComponentType } from 'react'
import type { Application } from '@/Application'
import type { Container } from '@/core/framework/container/Container'
import { Kernel } from '@/core/framework/container/Kernel'
import { Tokens } from '@/core/providers/tokens'
import { RenderingServiceProvider } from '@/core/providers/RenderingServiceProvider'
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'
import { UiServiceProvider } from '@/ui/providers/UiServiceProvider'
import { Command } from '@/core/framework/commands/Command'
import { DiProvider } from '@/ui/di-react'
import SimulationUI from './SimulationUI'

export interface SimulationRuntime {
  container: Container
  app: Application
  SimulationUI: ComponentType
}

// A failed bootstrap resumes this kernel's existing singleton graph. In
// particular, already-created renderers and controls must never be replaced.
const kernel = new Kernel([RenderingServiceProvider, AppServiceProvider, UiServiceProvider])
let initialized: SimulationRuntime | null = null
let pending: Promise<SimulationRuntime> | null = null

export function getInitializedSimulationRuntime(): SimulationRuntime | null {
  return initialized
}

export function initializeSimulationRuntime(): Promise<SimulationRuntime> {
  pending ??= Promise.resolve().then(() => {
    const container = kernel.bootstrap()
    const app = container.get(Tokens.Application)
    Command.bindContainer(container)
    initialized = {
      container,
      app,
      SimulationUI: () => <DiProvider container={container}><SimulationUI /></DiProvider>
    }
    return initialized
  }).catch((error: unknown) => {
    pending = null
    throw error
  })
  return pending
}
