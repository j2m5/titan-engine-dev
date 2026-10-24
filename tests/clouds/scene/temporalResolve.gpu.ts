import { CloudsEffect } from '@takram/three-clouds'
import {
  DataTexture,
  FloatType,
  Mesh,
  NoBlending,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { installSceneCloudPatches } from '@/core/clouds/takram/sceneCloudLighting'

/** Render the installed resolve itself, including its real neighborhood clipping,
 * Bayer selection and motion rejection; no copied test-only blend kernel.
 */
export function checkSceneCloudTemporalResolve(
  renderer: WebGLRenderer,
  close: (actual: readonly number[], expected: readonly number[], label: string, tolerance?: number) => void
): void {
  const camera = new PerspectiveCamera()
  const effect = new CloudsEffect(camera)
  const binding = installSceneCloudPatches(effect)
  const material = effect.cloudsPass.resolveMaterial
  material.shadowLength = false
  material.depthTest = false
  material.depthWrite = false
  material.blending = NoBlending
  material.setSize(12, 12)
  const currentData = new Float32Array(3 * 3 * 4).fill(0.8)
  // A broad real neighborhood keeps 0.4 history inside the clipping bounds.
  currentData.fill(0, 4, 8)
  currentData.fill(1, 12, 16)
  const velocityData = new Float32Array(3 * 3 * 4)
  const historyData = new Float32Array(12 * 12 * 4).fill(0.4)
  currentData[19] = 0.5
  for (let i = 3; i < historyData.length; i += 4) historyData[i] = 0.5
  const current = new DataTexture(currentData, 3, 3, RGBAFormat, FloatType)
  const velocity = new DataTexture(velocityData, 3, 3, RGBAFormat, FloatType)
  const history = new DataTexture(historyData, 12, 12, RGBAFormat, FloatType)
  current.needsUpdate = history.needsUpdate = true
  material.uniforms.colorBuffer.value = current
  material.uniforms.depthVelocityBuffer.value = velocity
  material.uniforms.colorHistoryBuffer.value = history
  const target = new WebGLRenderTarget(12, 12, { type: FloatType, depthBuffer: false })
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const previousTarget = renderer.getRenderTarget()
  const pixels = new Float32Array(4)
  const sample = (frame: number, motionPixels = 0): number[] => {
    for (let i = 0; i < velocityData.length; i += 4) {
      velocityData[i] = 1
      velocityData[i + 1] = motionPixels / 12
    }
    velocity.needsUpdate = true
    material.uniforms.frame.value = frame
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    // (4,4) is Bayer entry zero, updated at frames 0,16,32,...
    renderer.readRenderTargetPixels(target, 4, 4, 1, 1, pixels)
    return [...pixels]
  }
  const scalar = (value: number): number[] => [value, value, value, value]
  try {
    close(sample(32), [0.6, 0.6, 0.6, 0.5], 'stationary fresh pixel accumulates valid history', 1e-5)
    currentData[19] = 0.54
    current.needsUpdate = true
    close(sample(32), [0.6, 0.6, 0.6, 0.52], 'small opacity noise still accumulates', 1e-5)
    currentData[19] = 0.5
    current.needsUpdate = true
    close(sample(33), [0.4, 0.4, 0.4, 0.5], 'unrefreshed pixel preserves clipped history', 1e-5)
    close(sample(32, 1.25), [0.7, 0.7, 0.7, 0.5], 'moderate motion relaxes accumulation', 1e-5)
    close(sample(32, 2), [0.8, 0.8, 0.8, 0.5], 'fast motion uses the fresh sample', 1e-5)
    close(sample(32, 12), [0.8, 0.8, 0.8, 0.5], 'out-of-view history is rejected', 1e-5)
    // Mixed neighborhoods allow stale history through variance clipping. A new
    // clear ray must still clear immediately, even at subpixel motion.
    currentData.fill(0, 16, 20)
    historyData.fill(0.9)
    current.needsUpdate = history.needsUpdate = true
    close(sample(32, 0.25), scalar(0), 'fresh clear edge rejects cloudy history in a mixed neighborhood', 1e-5)
    currentData.fill(0.2, 16, 20)
    current.needsUpdate = true
    close(sample(32), scalar(0.2), 'large opacity change rejects stale partially cloudy history', 1e-5)
    currentData.fill(0.8, 16, 20)
    historyData.fill(0.4)
    currentData[19] = 0.5
    for (let i = 3; i < historyData.length; i += 4) historyData[i] = 0.5
    current.needsUpdate = history.needsUpdate = true
    // Production begins at frame 1. Bayer position zero is refreshed last.
    close(sample(16), [0.8, 0.8, 0.8, 0.5], 'sixteenth first-cycle fresh pixel rejects history', 1e-5)
    currentData.fill(0.7)
    current.needsUpdate = true
    close(sample(32), scalar(0.7), 'constant field remains constant', 1e-5)
    currentData.fill(0)
    historyData.fill(0.9)
    current.needsUpdate = history.needsUpdate = true
    close(sample(32), scalar(0), 'fresh clear neighborhood removes stale cloud', 1e-5)
    close(sample(33), scalar(0), 'held clear neighborhood removes stale cloud', 1e-5)
  } finally {
    renderer.setRenderTarget(previousTarget)
    binding.dispose()
    effect.dispose()
    for (const resource of [current, velocity, history, target, geometry]) resource.dispose()
  }
}
