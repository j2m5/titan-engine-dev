import type { CloudsEffect } from '@takram/three-clouds'
import { ShaderPass } from 'postprocessing'
import {
  DataUtils,
  FloatType,
  GLSL3,
  NearestFilter,
  NoBlending,
  RawShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { prepareCloudCurrentOutput } from '@/core/clouds/takram/prepareCloudCurrentOutput'

/** Write through the production adapter into the backend's actual attachment,
 * then execute its installed closest-fragment selector. Distinct depths must
 * retain the nearer fragment's motion, including beyond the half-float range. */
export function checkSceneCloudDepthRange(
  renderer: WebGLRenderer,
  effect: CloudsEffect,
  check: (condition: boolean, label: string) => void
): void {
  const current = Reflect.get(effect.cloudsPass, 'currentRenderTarget') as WebGLRenderTarget
  const originalSize = [current.width, current.height]
  const previous = renderer.getRenderTarget()
  const source = effect.cloudsPass.resolveMaterial.fragmentShader
  const offsets = source.match(/const ivec2 neighborOffsets\[9\] = ivec2\[9\]\([^]*?\n\);/)?.[0]
  const kernel = source.match(/vec4 getClosestFragment\(const ivec2 coord\) \{[^]*?\n\}/)?.[0]
  check(!!offsets && !!kernel, 'installed closest-depth selector is present')
  check(
    effect.cloudsPass.resolveMaterial.uniforms.depthVelocityBuffer.value === current.textures[1],
    'resolve consumes the actual current depth attachment'
  )
  const vertexShader = 'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}'
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    uniforms: { centerDepthVelocity: { value: new Vector3() }, neighborDepthVelocity: { value: new Vector3() } },
    fragmentShader: `precision highp float;
uniform vec3 centerDepthVelocity, neighborDepthVelocity;
layout(location = 0) out vec4 outputColor;
layout(location = 1) out vec3 outputDepthVelocity;
void main() {
  outputColor = vec4(0.25, 0.5, 0.75, 0.8);
  bool center = all(equal(ivec2(gl_FragCoord.xy), ivec2(1, 1)));
  outputDepthVelocity = center ? centerDepthVelocity : neighborDepthVelocity;
}`
  })
  const writer = new ShaderPass(material)
  const binding = prepareCloudCurrentOutput(writer)
  const selected = new WebGLRenderTarget(1, 1, {
    type: FloatType,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false
  })
  const selector = new ShaderPass(
    new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      uniforms: { depthVelocityBuffer: { value: current.textures[1] } },
      fragmentShader: `precision highp float;
uniform sampler2D depthVelocityBuffer;
layout(location = 0) out vec4 outputColor;
${offsets}
${kernel}
void main() { outputColor = getClosestFragment(ivec2(1, 1)); }`
    })
  )
  const motionA = [1 / 256, -1 / 512] as const
  const motionB = [1 / 512, -1 / 1024] as const
  const cases = [
    { label: 'near control', center: 1000, neighbor: 2000, want: 1000, motion: motionA },
    { label: '100/200 km', center: 100000, neighbor: 200000, want: 100000, motion: motionA },
    { label: 'FP16 boundary', center: 65504, neighbor: 65520, want: 65504, motion: motionA },
    { label: 'one metre separation', center: 100000, neighbor: 100001, want: 100000, motion: motionA },
    { label: 'beyond old resolve limit', center: 20000000, neighbor: 40000000, want: 20000000, motion: motionA },
    { label: 'giant range', center: 400000000, neighbor: 500000000, want: 400000000, motion: motionA },
    { label: 'nearer neighbor', center: 200000, neighbor: 100000, want: 100000, motion: motionB },
    { label: 'equal depths retain first neighbor', center: 100000, neighbor: 100000, want: 100000, motion: motionB },
    { label: 'clear sky behind cloud', center: 100000, neighbor: 1e30, want: 100000, motion: motionA },
    { label: 'clear sky retains motion', center: 1e30, neighbor: 1e30, want: 1e30, motion: motionB },
    { label: 'zero depth', center: 0, neighbor: 100000, want: 0, motion: motionA }
  ]
  try {
    for (const [width, height] of [
      [3, 3],
      [7, 5]
    ]) {
      current.setSize(width, height)
      for (const fixture of cases) {
        material.uniforms.centerDepthVelocity.value.set(fixture.center, ...motionA)
        material.uniforms.neighborDepthVelocity.value.set(fixture.neighbor, ...motionB)
        writer.render(renderer, null, current)
        selector.render(renderer, null, selected)
        const result = new Float32Array(4)
        renderer.readRenderTargetPixels(selected, 0, 0, 1, 1, result)
        check(
          result[0] === Math.fround(fixture.want) && result[1] === fixture.motion[0] && result[2] === fixture.motion[1],
          `${fixture.label} ${width}x${height}: closest depth/motion ${[...result.slice(0, 3)]}, ` +
            `expected ${[Math.fround(fixture.want), ...fixture.motion]}`
        )
        const data = current.textures[1].type === FloatType ? new Float32Array(4) : new Uint16Array(4)
        renderer.readRenderTargetPixels(current, 1, 1, 1, 1, data, undefined, 1)
        const stored = data instanceof Float32Array ? [...data] : Array.from(data, DataUtils.fromHalfFloat)
        check(
          stored[0] === Math.fround(fixture.center),
          `${fixture.label}: stored depth ${stored[0]} != ${fixture.center}`
        )
        check(stored[1] === motionA[0] && stored[2] === motionA[1], `${fixture.label}: stored motion is intact`)
      }
    }
    check(renderer.getContext().getError() === 0, 'depth-range GPU check has no GL errors')
  } finally {
    renderer.setRenderTarget(previous)
    binding.dispose()
    writer.dispose()
    selector.dispose()
    selected.dispose()
    current.setSize(originalSize[0], originalSize[1])
  }
}
