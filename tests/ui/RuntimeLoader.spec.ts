import { expect, it, vi } from 'vitest'

const { importModule } = vi.hoisted(() => ({ importModule: vi.fn() }))
vi.mock('@/ui/runtime/simulationRuntime', () => importModule())

it('shares a pending module load and retries an import rejected by the network', async () => {
  let reject!: (error: Error) => void
  importModule.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no }))
  const { loadSimulationRuntimeModule } = await import('@/ui/runtime/runtimeLoader')
  const a = loadSimulationRuntimeModule()
  const b = loadSimulationRuntimeModule()
  expect(a).toBe(b)
  // The mock module is an actual asynchronous module boundary; wait for
  // Vitest to enter it before simulating a failed transfer.
  await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1))
  reject(new Error('network interrupted'))
  await expect(a).rejects.toThrow()
  // Vitest caches failed mock factories, unlike browser import fetches.
  // A fresh module factory simulates a subsequent successful transfer.
  vi.doUnmock('@/ui/runtime/simulationRuntime')
  vi.doMock('@/ui/runtime/simulationRuntime', () => ({ initializeSimulationRuntime: async () => ({}) }))
  await expect(loadSimulationRuntimeModule()).resolves.toHaveProperty('initializeSimulationRuntime')
})
