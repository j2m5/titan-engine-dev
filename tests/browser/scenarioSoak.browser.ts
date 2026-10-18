import { Scenarios } from '@/config/scenarios'
import { Tokens } from '@/core/providers/tokens'
import { engineStore } from '@/ui/mobx/EngineStore'
import { getInitializedSimulationRuntime } from '@/ui/runtime/simulationRuntime'
import type { WebGLRenderer } from 'three'

let firstRenderer: WebGLRenderer | null = null

function runtime() {
  const value = getInitializedSimulationRuntime()
  if (!value) throw new Error('Scenario runtime has not initialized')
  return value
}

export async function selectScenario(id: number) {
  const scenario = Scenarios.find(item => item.id === id)
  if (!scenario) throw new Error(`Unknown scenario ${id}`)
  const start = performance.now()
  await engineStore.setScenario(scenario)
  if (engineStore.scenario?.id !== id || engineStore.appLoadingStatus) {
    throw new Error(`Scenario ${id} failed to start`)
  }
  return { id, name: scenario.name, startupMs: performance.now() - start }
}

export function snapshot() {
  const { container } = runtime()
  const renderer = container.get(Tokens.Renderer)
  if (firstRenderer && firstRenderer !== renderer) throw new Error('Scenario switches replaced the session renderer')
  firstRenderer = renderer
  const gl = renderer.getContext()
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  return {
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0,
    canvases: document.querySelectorAll('canvas').length,
    createdWebGLContexts: Reflect.get(window, '__soakWebGLContexts') as number,
    renderCalls: renderer.info.render.calls,
    frame: renderer.info.render.frame,
    renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) as string,
    userAgent: navigator.userAgent,
    viewport: [innerWidth, innerHeight],
    devicePixelRatio
  }
}

/** A repeatable far-field orbit, with modest radial motion to exercise streaming decisions. */
export async function exerciseScenario(durationMs: number) {
  const camera = runtime().container.get(Tokens.Camera)
  const origin = camera.position.clone()
  const startFrame = snapshot().frame
  const intervals: number[] = []
  const start = performance.now()
  let previous: number | undefined
  await new Promise<void>(resolve => {
    const tick = (now: number) => {
      if (previous !== undefined) intervals.push(now - previous)
      previous = now
      const progress = Math.min(1, (now - start) / durationMs)
      const angle = progress * Math.PI * 2
      const radius = 1 + 0.15 * Math.sin(angle * 2)
      camera.position.set(
        (origin.x * Math.cos(angle) + origin.z * Math.sin(angle)) * radius,
        origin.y * radius,
        (origin.z * Math.cos(angle) - origin.x * Math.sin(angle)) * radius
      )
      camera.lookAt(0, 0, 0)
      if (progress >= 1) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  camera.position.copy(origin)
  camera.lookAt(0, 0, 0)
  const resources = snapshot()
  if (resources.frame <= startFrame || intervals.length < 2) {
    throw new Error('The scenario stopped rendering during its measurement window')
  }
  return { elapsedMs: performance.now() - start, intervals, resources }
}

export async function returnToMenu() {
  await engineStore.setScenario(null)
  // Let queued microtasks, cancelled network callbacks and React's detach complete before GC.
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  return snapshot()
}
