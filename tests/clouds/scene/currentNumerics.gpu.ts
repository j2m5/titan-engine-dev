import { ShaderPass } from 'postprocessing'
import {
  DataUtils,
  GLSL3,
  HalfFloatType,
  NoBlending,
  RawShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { prepareCloudCurrentOutput } from '@/core/clouds/takram/prepareCloudCurrentOutput'

/** Execute the installed current-pass interval gate before its density march.
 * A NaN endpoint must not reach sampling or the temporal depth/velocity output. */
export function checkSceneCloudCurrentNumerics(
  renderer: WebGLRenderer,
  source: string,
  check: (condition: boolean, label: string) => void
): void {
  const start = source.indexOf('  float sceneViewZ;'),
    end = source.indexOf('  float stbn = getSTBN();', start)
  check(start >= 0 && end > start, 'production current interval gate is present')
  const previous = renderer.getRenderTarget(),
    baseline = renderer.info.memory.textures
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    uniforms: { fixtureInterval: { value: new Vector2() }, fixtureSceneDistance: { value: 0 } },
    vertexShader: 'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}',
    fragmentShader: `precision highp float;
uniform vec2 fixtureInterval;
uniform float fixtureSceneDistance;
layout(location = 0) out vec4 outputColor;
layout(location = 1) out vec3 outputDepthVelocity;
float getRayDistanceToScene(vec3 direction, out float viewZ) {
  viewZ = -fixtureSceneDistance; return fixtureSceneDistance;
}
void main() {
  vec2 rayNearFar = fixtureInterval;
  vec3 rayDirection = vec3(0.0, 0.0, 1.0);
${source.slice(start, end)}
  outputColor = vec4(rayNearFar, float(intersectsGround), float(intersectsScene));
  outputDepthVelocity = vec3(7.0, 8.0, 9.0);
}`
  })
  const pass = new ShaderPass(material),
    target = new WebGLRenderTarget(1, 1, { count: 2, type: HalfFloatType, depthBuffer: false })
  let binding: ReturnType<typeof prepareCloudCurrentOutput> | undefined
  const cases = [
    { interval: [2, 8], scene: 0, expected: [2, 8, 0, 0] },
    { interval: [2, 8], scene: 5, expected: [2, 5, 0, 0] },
    { interval: [2, 1], scene: 0, expected: [2, 1, 0, 1] },
    { interval: [-1, -1], scene: 0, expected: [-1, -1, 1, 0] },
    { interval: [Number.NaN, 8], scene: 0, expected: [0, 0, 0, 0] },
    { interval: [2, Number.NaN], scene: 0, expected: [0, 0, 0, 0] }
  ]
  try {
    for (const packed of [false, true]) {
      if (packed) binding = prepareCloudCurrentOutput(pass)
      for (const { interval, scene, expected } of cases) {
        material.uniforms.fixtureInterval.value.fromArray(interval)
        material.uniforms.fixtureSceneDistance.value = scene
        pass.render(renderer, null, target)
        const invalid = interval.some(Number.isNaN)
        for (const attachment of [0, 1]) {
          const data = new Uint16Array(4)
          renderer.readRenderTargetPixels(target, 0, 0, 1, 1, data, undefined, attachment)
          const actual = Array.from(data, DataUtils.fromHalfFloat).slice(0, attachment ? 3 : 4)
          const wanted = attachment ? (invalid ? [0, 0, 0] : [7, 8, 9]) : expected
          check(
            actual.every((value, i) => value === wanted[i]),
            `current interval ${interval}, scene=${scene}, packed=${packed}, attachment=${attachment}: ${actual} != ${wanted}`
          )
        }
      }
      binding?.dispose()
      binding = undefined
    }
    check(renderer.getContext().getError() === 0, 'current interval GPU check has no GL errors')
  } finally {
    renderer.setRenderTarget(previous)
    binding?.dispose()
    pass.dispose()
    target.dispose()
  }
  check(renderer.info.memory.textures === baseline, 'current interval fixture resources released')
}
