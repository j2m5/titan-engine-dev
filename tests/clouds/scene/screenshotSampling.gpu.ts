import { CloudsEffect } from '@takram/three-clouds'
import { DataUtils, Uniform, type WebGLRenderer, type WebGLRenderTarget } from 'three'
import type { CloudFrame } from '@/core/clouds/scene/CloudFrame'
import { installSceneCloudPatches } from '@/core/clouds/takram/sceneCloudLighting'
import type { SceneCloudDepthFrame } from '@/core/graphic/clouds/SceneCloudDepth'
import type { AtmosphereEntry } from '@/core/services/AtmosphereRegistry'

/** Replace only the ray's color and motion with known values. Camera jitter,
 * pass scheduling, resolve, buffer swaps and the returned overlay are real. */
export function checkSceneCloudScreenshotSampling(
  renderer: WebGLRenderer,
  frame: CloudFrame,
  depth: SceneCloudDepthFrame,
  atmosphere: AtmosphereEntry,
  check: (condition: boolean, label: string) => void
): void {
  const width = 13,
    height = 9
  const effect = new CloudsEffect(frame.camera)
  effect.lightShafts = false
  effect.setSize(width, height)
  const binding = installSceneCloudPatches(effect)
  const pass = effect.cloudsPass
  const current = pass.currentMaterial
  current.vertexShader =
    'precision highp float; in vec3 position; void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }'
  current.fragmentShader = `precision highp float;
uniform vec2 temporalJitter, resolution;
uniform float mipLevelScale, fixtureBlue;
layout(location = 0) out vec4 color;
layout(location = 1) out vec3 depthVelocity;
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  if (mipLevelScale < 1.0) pixel = 4 * pixel + ivec2(floor(temporalJitter * resolution + 2.0));
  float alpha = (pixel.x + pixel.y) % 3 == 0 ? 0.0 : 0.75;
  color = vec4((vec2(pixel) + 1.0) / 16.0, fixtureBlue, 1.0) * alpha;
  depthVelocity = vec3(100.0, 0.25, -0.25);
}`
  const blue = new Uniform(0.5)
  current.uniforms.fixtureBlue = blue
  const previousTarget = renderer.getRenderTarget()
  // Observe the actual resolved texture without borrowing private ping-pong indices.
  const drawResolve = pass.resolvePass.render
  let draws = 0
  const targets = new Map<typeof pass.outputBuffer, WebGLRenderTarget>()
  pass.resolvePass.render = function (renderer, input, output, ...rest) {
    if (!output) throw new Error('Cloud resolve has no output target')
    drawResolve.call(this, renderer, input, output, ...rest)
    targets.set(output.texture, output)
    draws++
  }
  const capture = { ...frame, deltaSeconds: 0, sampling: 'complete' as const }
  const checkCapture = (start: number, label: string) => {
    draws = 0
    binding.update(capture, depth, atmosphere)
    pass.update(renderer, start, 0)
    const target = targets.get(pass.outputBuffer)!
    const data = new Uint16Array(width * height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, data)
    let mismatches = 0
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const alpha = (x + y) % 3 === 0 ? 0 : 0.75
        const expected = [(x + 1) / 16, (y + 1) / 16, blue.value, 1]
        if (expected.some((v, i) => DataUtils.fromHalfFloat(data[4 * (y * width + x) + i]) !== v * alpha)) mismatches++
      }
    check(mismatches === 0, `${label}: ${mismatches}/${width * height} pixels differ from their own ray`)
    check(draws === (pass.temporalUpscale ? 16 : 1), `${label}: ${draws} resolve draws`)
  }
  try {
    checkCapture(1, 'cold screenshot')
    blue.value = 0.25
    checkCapture(37, 'screenshot with old history and offset Bayer phase')
    binding.update({ ...frame, deltaSeconds: 0 }, depth, atmosphere)
    draws = 0
    pass.update(renderer, 38, 0)
    check(draws === 1, 'paused presentation after capture uses one cloud sample per tile')
    pass.temporalUpscale = false
    checkCapture(39, 'non-sparse screenshot')
  } finally {
    pass.resolvePass.render = drawResolve
    renderer.setRenderTarget(previousTarget)
    binding.dispose()
    effect.dispose()
  }
}
