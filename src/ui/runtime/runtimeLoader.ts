// This module belongs to the home shell: keep runtime dependencies type-only.
type SimulationModule = typeof import('./simulationRuntime')

let pendingModule: Promise<SimulationModule> | null = null

export function loadSimulationRuntimeModule(): Promise<SimulationModule> {
  pendingModule ??= import('./simulationRuntime').catch((error: unknown) => {
    pendingModule = null
    throw error
  })
  return pendingModule
}
