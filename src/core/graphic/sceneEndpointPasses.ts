import { EffectPass, RenderPass, type Pass } from 'postprocessing'
import type { Scene, PerspectiveCamera } from 'three'
import type { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import type { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import type { LensRegistry } from '@/core/services/LensRegistry'
import { AtmosphereEffect } from './effects/atmosphere/AtmosphereEffect'
import { createGravitationalLensPass } from '@/core/graphic/effects/lens/GravitationalLensEffect'
import { SkyLayer } from '@/core/graphic/passes/SkyLayer'
import { DepthVolumePass } from '@/core/graphic/passes/DepthVolumePass'
import { BlackHolePass } from '@/core/graphic/passes/BlackHolePass'
import { OverlayPass } from '@/core/graphic/passes/OverlayPass'
import { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'
import { LensFrontSplitPass } from '@/core/graphic/passes/LensFrontSplitPass'
import { LensFrontPass } from '@/core/graphic/passes/LensFrontPass'

export interface SceneEndpointContext {
  scene: Scene
  camera: PerspectiveCamera
  atmosphereRegistry: AtmosphereRegistry
  depthVolumeRegistry: DepthVolumeRegistry
  lensRegistry: LensRegistry
  atmosphereDebugView: number
}
export function createSceneEndpointPasses(
  context: SceneEndpointContext,
  atmosphereStage?: { effect: AtmosphereEffect; pass: EffectPass }
): {
  passes: readonly Pass[]
  atmosphere: AtmosphereEffect
  lensFront: LensFrontSorter
} {
  const atmosphere = atmosphereStage?.effect ?? new AtmosphereEffect(context.camera, context.atmosphereRegistry, {
    debugView: context.atmosphereDebugView
  })
  const lensFront = new LensFrontSorter(
    context.scene,
    context.camera,
    context.lensRegistry,
    context.depthVolumeRegistry
  )
  // Слой видимого неба: рисует BlackHolePass, читает дальнее поле линзы
  const skyLayer = new SkyLayer()

  const passes = [
    new LensFrontSplitPass(lensFront),
    new RenderPass(context.scene, context.camera),
    new DepthVolumePass(context.camera, context.depthVolumeRegistry, lensFront),
    new BlackHolePass(context.camera, context.lensRegistry, skyLayer),
    createGravitationalLensPass(context.camera, context.lensRegistry, skyLayer),
    new LensFrontPass(context.scene, context.camera, lensFront),
    new OverlayPass(context.scene, context.camera),
    atmosphereStage?.pass ?? new EffectPass(context.camera, atmosphere)
  ]
  return { passes, atmosphere, lensFront }
}
