import '@/core/framework/TitanThree'
import { Engine } from '@/core/Engine'
import { SimulationClock } from '@/core/time/SimulationClock'
import { WaterSphere } from '@/core/renderables/Water/WaterSphere'
import type { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import type { SceneManager } from '@/core/services/SceneManager'
import type { Postprocessing } from '@/core/graphic/Postprocessing'
import type { SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three'

/** Actual Engine/SceneManager/render paths; only external clock/control/DOM ports are controlled. */
export async function verifySimulationPresentations(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  manager: SceneManager,
  post: Postprocessing,
  runtime: SceneCloudRuntime,
  node: DynamicNode,
  setDistance: (distance: number) => void,
  fullDistance: number,
  cutoffDistance: number
): Promise<unknown> {
  let water: WaterSphere | undefined
  node.traverse((object) => {
    if (object instanceof WaterSphere) water = object
  })
  if (!water) throw Error('Scheduling proof requires actual WaterSphere')
  const actualWater = water
  const clock = new SimulationClock(2451545)
  let advanceCalls = 0,
    nodeUpdates = 0,
    waterUpdates = 0,
    elapsed = 0
  let distance = cutoffDistance + 1000,
    inject = false
  const snapshot = () => ({
    epoch: clock.epoch,
    advanceCalls,
    nodeUpdates,
    waterUpdates,
    waterTime: actualWater.material.uniforms.uTime.value as number,
    rotation: node.renderable!.quaternion.toArray()
  })
  type State = ReturnType<typeof snapshot>
  type Frame = {
    weight: number
    before: State
    entry?: State
    exit?: State
    draws: { before: State; after: State; scene: boolean }[]
  }
  let current: Frame | null = null
  const frames: Frame[] = []
  const oldAdvance = clock.advance,
    oldNodeUpdate = node.updateObject,
    oldWaterUpdate = actualWater.updateObject
  const oldDraw = renderer.render,
    oldPost = post.render,
    oldLoop = renderer.setAnimationLoop
  const oldManagerInitialize = manager.initialize,
    oldPostInitialize = post.initialize
  clock.advance = (delta) => {
    advanceCalls++
    oldAdvance.call(clock, delta)
  }
  node.updateObject = (ctx) => {
    nodeUpdates++
    oldNodeUpdate.call(node, ctx)
  }
  actualWater.updateObject = (ctx) => {
    waterUpdates++
    oldWaterUpdate.call(actualWater, ctx)
  }
  renderer.setAnimationLoop = () => {} // Engine.update is the explicit public scheduler for this fixture.
  renderer.render = (drawScene, drawCamera) => {
    if (!current) return oldDraw.call(renderer, drawScene, drawCamera)
    const before = snapshot()
    if (inject) {
      inject = false
      clock.advance(0.125)
    }
    oldDraw.call(renderer, drawScene, drawCamera)
    current.draws.push({ before, after: snapshot(), scene: drawScene === scene })
  }
  post.render = (delta) => {
    if (current) current.entry = snapshot()
    oldPost.call(post, delta)
    if (current) current.exit = snapshot()
  }
  // The Earth fixture is already built/initialized; normal production update/render methods remain real.
  manager.initialize = () => {}
  post.initialize = () => {}
  const overlay = document.createElement('div')
  const engine = new Engine(
    manager,
    { tick: () => {}, dispose: () => {} } as never,
    clock,
    {
      speed: 0,
      updateFollow: () => {
        setDistance(distance)
        return null
      },
      stopFollowing: () => {}
    } as never,
    renderer,
    { domElement: overlay, render: () => {} } as never,
    scene,
    camera,
    { update: () => {}, setSurface: () => {} } as never,
    {
      getDelta: () => {
        elapsed += 0.25
        return 0.25
      },
      getElapsedTime: () => elapsed
    } as never,
    post,
    { resolve: () => {}, nearestSurface: () => null } as never
  )
  const invariant = (frame: Frame) =>
    !!frame.entry &&
    !!frame.exit &&
    JSON.stringify(frame.entry) === JSON.stringify(frame.exit) &&
    frame.draws.every(
      (draw) =>
        JSON.stringify(draw.before) === JSON.stringify(frame.entry) &&
        JSON.stringify(draw.after) === JSON.stringify(frame.entry)
    )
  try {
    engine.initialize()
    manager.initialize = oldManagerInitialize
    post.initialize = oldPostInitialize
    engine.start()
    engine.update() // Warm the real orbit/follow and terrain visibility, never counted as a measured presentation.
    for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
      let lo = 0,
        hi = 1
      for (let i = 0; i < 50; i++) {
        const t = (lo + hi) / 2
        if (1 - t * t * (3 - 2 * t) > weight) lo = t
        else hi = t
      }
      distance =
        weight === 0
          ? cutoffDistance + 1000
          : weight === 1
            ? fullDistance - 1000
            : fullDistance + ((cutoffDistance - fullDistance) * (lo + hi)) / 2
      if (weight > 0 && runtime.diagnostics.effectiveWeight === 0) {
        setDistance(distance)
        const beforeReady = snapshot(),
          started = performance.now()
        do {
          await new Promise(requestAnimationFrame)
          oldPost.call(post, 0)
          if (performance.now() - started > 15000 || runtime.diagnostics.reason === 'error')
            throw Error('Tiny scheduling fixture failed readiness: ' + String(runtime.error))
        } while (runtime.diagnostics.effectiveWeight === 0)
        if (JSON.stringify(snapshot()) !== JSON.stringify(beforeReady))
          throw Error('Presentation-only readiness warmup advanced simulation/animation')
      }
      const frame: Frame = { weight, before: snapshot(), draws: [] }
      current = frame
      const passBefore = runtime.diagnostics
      engine.update()
      current = null
      const after = snapshot(),
        passes = runtime.diagnostics
      if (!invariant(frame)) throw Error('Simulation/animation changed inside presentation ' + JSON.stringify(frame))
      if (
        after.advanceCalls - frame.before.advanceCalls !== 1 ||
        after.nodeUpdates - frame.before.nodeUpdates !== 1 ||
        after.waterUpdates - frame.before.waterUpdates !== 1 ||
        !(after.epoch > frame.before.epoch) ||
        !(after.waterTime > frame.before.waterTime) ||
        after.waterTime !== elapsed ||
        JSON.stringify(after.rotation) === JSON.stringify(frame.before.rotation)
      )
        throw Error(
          'Normal Engine frame did not advance actual simulation/animation exactly once ' +
            JSON.stringify({ frame, after, elapsed })
        )
      if (
        Math.abs(passes.effectiveWeight - weight) > 1e-6 ||
        passes.depthPasses - passBefore.depthPasses !== (weight > 0 ? 1 : 0) ||
        passes.nearRenders - passBefore.nearRenders !== (weight > 0 ? 1 : 0) ||
        passes.farRenders - passBefore.farRenders !== (weight < 1 ? 1 : 0)
      )
        throw Error(
          'Actual endpoint schedule missing ' +
            JSON.stringify({ weight, passBefore, passes, cause: String(runtime.error) })
        )
      if (frame.draws.filter((draw) => draw.scene).length < (weight === 0 ? 2 : weight === 1 ? 4 : 6))
        throw Error('Actual scene redraws not observed')
      frames.push(frame)
    }
    const negative: Frame = { weight: 1, before: snapshot(), draws: [] }
    current = negative
    inject = true
    engine.update()
    current = null
    if (invariant(negative)) throw Error('Detector missed controlled draw-time clock mutation')
    return { frames, negativeControlDetected: true, negative, inputDeltaSeconds: 0.25 }
  } finally {
    current = null
    engine.stop()
    manager.initialize = oldManagerInitialize
    post.initialize = oldPostInitialize
    clock.advance = oldAdvance
    node.updateObject = oldNodeUpdate
    actualWater.updateObject = oldWaterUpdate
    renderer.render = oldDraw
    post.render = oldPost
    renderer.setAnimationLoop = oldLoop
    renderer.domElement.remove()
    overlay.remove()
  }
}
