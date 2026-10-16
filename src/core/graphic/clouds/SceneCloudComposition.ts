import { Pass, type EffectComposer } from 'postprocessing'
import { Color, PerspectiveCamera, Scene, Texture, Vector2, Vector4, WebGLRenderer, WebGLRenderTarget } from 'three'
import type { CloudFramePlan, SceneCloudRuntime } from '@/core/clouds/SceneCloudRuntime'
import type { AtmosphereFrameSnapshot } from '@/core/graphic/effects/atmosphere/atmosphereFrame'
import type { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import type { SceneCloudOutput } from '@/core/clouds/takram/SceneCloudBackend'
import { SceneCloudDepth } from './SceneCloudDepth'
import { withSceneCloudMaterials } from './sceneCloudMaterialScope'
import { captureShaderCompilation } from '@/core/graphic/effects/atmosphere/shaderCompilationScope'
import type { CloudCompilationEvidence } from '@/core/clouds/scene/cloudCompilationFailure'
import type { SceneCloudReceiver } from '@/core/clouds/receivers/SceneCloudReceiver'
export function cloudEndpointSchedule(weight: number): { far: boolean; near: boolean } {
  return { far: weight < 1, near: weight > 0 }
}
export class CloudEndpointCapturePass extends Pass {
  private last: Texture | null = null
  public constructor() {
    super('CloudEndpointCapturePass')
    this.needsSwap = false
    this.renderToScreen = false
  }
  public get texture(): Texture | null {
    return this.last
  }
  public override render(_renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    this.last = inputBuffer.texture
  }
  public override dispose(): void {
    this.last = null
  }
}
export class SceneCloudComposition {
  private depth: SceneCloudDepth | null = null
  private near: ReturnType<SceneCloudComposition['createNearEndpoint']> | null = null
  private cssSize: Vector2 | null = null
  public constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly runtime: SceneCloudRuntime,
    private readonly createNearEndpoint: () => {
      composer: EffectComposer
      atmosphere: AtmosphereEffect
      capture: CloudEndpointCapturePass
    }
  ) {}
  public prepare(
    plan: CloudFramePlan,
    frameSnapshot: AtmosphereFrameSnapshot
  ): { output: SceneCloudOutput; texture: Texture; weight: number } | null {
    const renderer = this.renderer,
      target = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel()
    const viewport = renderer.getViewport(new Vector4()),
      scissor = renderer.getScissor(new Vector4()),
      test = renderer.getScissorTest()
    const layers = this.camera.layers.mask,
      shadowUpdate = renderer.shadowMap.autoUpdate,
      autoClear = renderer.autoClear
    const clearColor = renderer.getClearColor(new Color()),
      clearAlpha = renderer.getClearAlpha()
    const background = this.scene.background,
      override = this.scene.overrideMaterial
    let stage: CloudCompilationEvidence['stage'] = 'setup',
      currentReceiver: SceneCloudReceiver | null = null
    let contextRequired = false
    const failedReceivers = new Set<SceneCloudReceiver>()
    let ownedReceivers: readonly SceneCloudReceiver[] = []
    const compilation = captureShaderCompilation(renderer, 'Scene cloud endpoint', (reentrant) => {
      if (!reentrant && stage === 'near' && currentReceiver) failedReceivers.add(currentReceiver)
      else contextRequired = true
    })
    const evidence = (): CloudCompilationEvidence | undefined =>
      compilation.failed
        ? {
            stage,
            recovery: contextRequired || failedReceivers.size === 0 ? 'context' : 'owned-near',
            receivers: contextRequired ? [] : ownedReceivers
          }
        : undefined
    try {
      this.depth ??= new SceneCloudDepth(renderer, this.scene)
      if (!this.near) {
        this.near = this.createNearEndpoint()
        const css = this.cssSize ?? renderer.getSize(new Vector2())
        this.near.composer.setSize(css.x, css.y, false)
      }
      this.runtime.recordPasses({ depthPasses: 1 })
      stage = 'depth'
      const depth = this.depth.render(plan.frame)
      compilation.check()
      stage = 'backend'
      const output = this.runtime.renderVolume(renderer, this.near.composer.inputBuffer, plan, depth)
      if (!output) {
        compilation.check()
        return null
      }
      this.runtime.useEndpoint(plan, output)
      this.near.atmosphere.setFrame(frameSnapshot)
      this.near.atmosphere.setCloudOverlay(output)
      this.runtime.recordPasses({ nearRenders: 1 })
      stage = 'near'
      const owners = this.runtime.getEndpointMaterialOwners(plan)
      ownedReceivers = [...new Set(owners.values())]
      withSceneCloudMaterials(
        this.scene,
        this.runtime.getEndpointMaterialBindings(plan),
        () => {
          this.near!.composer.render(plan.frame.deltaSeconds)
        },
        {
          owners,
          set: (receiver) => {
            currentReceiver = receiver
          }
        }
      )
      compilation.check()
      const texture = this.near.capture.texture
      if (!texture) throw new Error('Near cloud endpoint produced no completed input buffer')
      return { output, texture, weight: plan.requestedWeight }
    } catch (error) {
      this.runtime.invalidate('error', error, evidence())
      return null
    } finally {
      compilation.restore()
      try {
        this.runtime.useEndpoint(null, null)
      } finally {
        this.near?.atmosphere.setCloudOverlay(null)
        this.near?.atmosphere.setFrame(null)
        this.camera.layers.mask = layers
        renderer.shadowMap.autoUpdate = shadowUpdate
        renderer.autoClear = autoClear
        renderer.setClearColor(clearColor, clearAlpha)
        this.scene.background = background
        this.scene.overrideMaterial = override
        renderer.setRenderTarget(target, face, mip)
        renderer.setViewport(viewport)
        renderer.setScissor(scissor)
        renderer.setScissorTest(test)
      }
    }
  }
  public setSize(width: number, height: number): void {
    this.cssSize = new Vector2(width, height)
    const physical = this.renderer.getDrawingBufferSize(new Vector2())
    this.runtime.setSize(physical.x, physical.y)
    this.depth?.setSize(physical.x, physical.y)
    this.near?.composer.setSize(width, height, false)
  }
  public dispose(): void {
    this.near?.composer.dispose()
    this.near = null
    this.depth?.dispose()
    this.depth = null
    this.cssSize = null
  }
}
