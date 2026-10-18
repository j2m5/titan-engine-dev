import { expect, it, vi } from 'vitest'
import { Container } from '@/core/framework/container/Container'
import { Tokens } from '@/core/providers/tokens'
import type { Application } from '@/Application'

const { bootstrap } = vi.hoisted(() => ({ bootstrap: vi.fn() }))
vi.mock('@/core/framework/TitanThree', () => ({}))
vi.mock('@/core/framework/container/Kernel', () => ({ Kernel: class { bootstrap = bootstrap } }))
vi.mock('@/core/providers/RenderingServiceProvider', () => ({ RenderingServiceProvider: class {} }))
vi.mock('@/core/providers/AppServiceProvider', () => ({ AppServiceProvider: class {} }))
vi.mock('@/ui/providers/UiServiceProvider', () => ({ UiServiceProvider: class {} }))
vi.mock('@/ui/runtime/SimulationUI', () => ({ default: () => null }))

it('shares initialization, retries a failed bootstrap and retains the successful session', async () => {
  const container = new Container()
  const app = {} as Application
  container.instance(Tokens.Application, app)
  bootstrap.mockImplementationOnce(() => { throw new Error('temporary WebGL failure') }).mockReturnValue(container)
  const { initializeSimulationRuntime, getInitializedSimulationRuntime } = await import('@/ui/runtime/simulationRuntime')
  expect(getInitializedSimulationRuntime()).toBeNull()
  const a = initializeSimulationRuntime()
  expect(initializeSimulationRuntime()).toBe(a)
  await expect(a).rejects.toThrow('temporary WebGL failure')
  expect(getInitializedSimulationRuntime()).toBeNull()
  const b = initializeSimulationRuntime()
  expect(initializeSimulationRuntime()).toBe(b)
  const runtime = await b
  expect(runtime.container).toBe(container)
  expect(runtime.app).toBe(app)
  expect(getInitializedSimulationRuntime()).toBe(runtime)
  expect(await initializeSimulationRuntime()).toBe(runtime)
  expect(bootstrap).toHaveBeenCalledTimes(2)
})
