import { ShaderPass } from 'postprocessing'
import {
  GLSL3,
  HalfFloatType,
  NoBlending,
  RawShaderMaterial,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { prepareCloudCurrentOutput } from '@/core/clouds/takram/prepareCloudCurrentOutput'

/** Compare the actual GPU export against the previous MRT half-float conversion.
 * Covers all seven channels, early returns, HDR, signed motion, half overflow and
 * odd viewport dimensions. It does not duplicate the packing/unpacking formula.
 */
export function checkSceneCloudCurrentOutput(
  renderer: WebGLRenderer,
  check: (condition: boolean, label: string) => void
): void {
  const previous = renderer.getRenderTarget()
  const textureBaseline = renderer.info.memory.textures
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    uniforms: { testColor: { value: new Vector4() }, testDepthVelocity: { value: new Vector3() } },
    vertexShader: 'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}',
    fragmentShader: `precision highp float;
uniform vec4 testColor;
uniform vec3 testDepthVelocity;
layout(location = 0) out vec4 outputColor;
layout(location = 1) out vec3 outputDepthVelocity;
void main() {
  outputColor = testColor;
  outputDepthVelocity = testDepthVelocity;
  if (mod(gl_FragCoord.x, 3.0) < 1.0) {
    outputColor = vec4(0.0);
    return;
  }
  outputColor.rg += gl_FragCoord.xy * 0.0001;
  outputDepthVelocity.gb += gl_FragCoord.xy * 0.00001;
}`
  })
  const pass = new ShaderPass(material)
  const target = new WebGLRenderTarget(7, 5, { count: 2, type: HalfFloatType, depthBuffer: false })
  const samples = [
    { color: [0.1, 0.5, 0.9, 0.3], depth: [1000, -0.25, 0.125] },
    { color: [12.5, -0.2, 65504, 1], depth: [1e30, 0.003, -0.0007] },
    { color: [0, 1e-7, 0.00003, 0], depth: [0, -0.0, 0] }
  ]
  let binding: ReturnType<typeof prepareCloudCurrentOutput> | undefined
  const render = (sample: (typeof samples)[number]): Uint16Array[] => {
    material.uniforms.testColor.value.fromArray(sample.color)
    material.uniforms.testDepthVelocity.value.fromArray(sample.depth)
    pass.render(renderer, null, target)
    return [0, 1].map((index) => {
      const data = new Uint16Array(target.width * target.height * 4)
      renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, data, undefined, index)
      return data
    })
  }
  try {
    for (const [width, height] of [
      [7, 5],
      [13, 9]
    ]) {
      target.setSize(width, height)
      const ordinary = samples.map(render)
      binding = prepareCloudCurrentOutput(pass)
      samples.forEach((sample, sampleIndex) => {
        const packed = render(sample)
        packed.forEach((data, attachment) => {
          const reference = ordinary[sampleIndex][attachment]
          // The second shader output is vec3 (depth + velocity.gb). Its fourth
          // attachment channel is not written or consumed by temporal resolve.
          const mismatch = data.findIndex((value, index) =>
            (attachment === 0 || index % 4 !== 3) && value !== reference[index])
          check(
            mismatch === -1,
            `packed cloud half-float parity ${width}x${height}, sample ${sampleIndex}, attachment ${attachment}, ` +
              `component ${mismatch}: ${data[mismatch]} != ${reference[mismatch]}`
          )
        })
      })
      binding.dispose()
      binding = undefined
    }
  } finally {
    renderer.setRenderTarget(previous)
    binding?.dispose()
    pass.dispose()
    target.dispose()
  }
  check(renderer.info.memory.textures === textureBaseline, 'packed cloud targets released after repeated setup')
}
