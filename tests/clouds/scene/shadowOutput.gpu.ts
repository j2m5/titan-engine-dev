import { CloudsEffect } from '@takram/three-clouds'
import { ShaderPass } from 'postprocessing'
import {
  DataArrayTexture,
  FloatType,
  GLSL3,
  HalfFloatType,
  NoBlending,
  PerspectiveCamera,
  RawShaderMaterial,
  Uniform,
  WebGLArrayRenderTarget,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { prepareCloudShadowOutput } from '@/core/clouds/takram/prepareCloudShadowOutput'
import { prepareCloudTargets } from '@/core/clouds/takram/prepareCloudTargets'

/** Compare every layer against the pinned MRT path, including the real temporal
 * resolve. Using the same already-attached targets also catches stale MRT slots.
 */
export function checkSceneCloudShadowOutput(
  renderer: WebGLRenderer,
  check: (condition: boolean, label: string) => void
): void {
  const previous = renderer.getRenderTarget(),
    baseline = renderer.info.memory.textures
  const effect = new CloudsEffect(new PerspectiveCamera()),
    shadow = effect.shadowPass
  const restoreTargets = prepareCloudTargets(effect)
  const material = shadow.currentMaterial
  // Keep the pinned output contract and main; supply an independent, deterministic
  // cascade with distinct channels, fractional motion, half overflow and early exits.
  const declarationStart = material.fragmentShader.indexOf('layout(location = 0) out vec4 outputColor[CASCADE_COUNT];')
  const declarationEnd =
    material.fragmentShader.indexOf('#endif // CASCADE_COUNT', declarationStart) + '#endif // CASCADE_COUNT'.length
  const main = material.fragmentShader.slice(material.fragmentShader.lastIndexOf('void main()'))
  material.fragmentShader = `precision highp float;
uniform float sampleFrame;
in vec2 vUv;
${material.fragmentShader.slice(declarationStart, declarationEnd)}
void cascade(const int index, const float mip, out vec4 color, out vec3 depthVelocity) {
  float k = float(index + 1);
  color = vec4(k * 20.0 + gl_FragCoord.x, k * 0.03125, vUv.y + sampleFrame * 0.125, mip + 0.5);
  depthVelocity = vec3(k * 20.0, k * 0.03125, -k * 0.0625);
  if (gl_FragCoord.x < 1.0) depthVelocity.r = 1e30;
  if (gl_FragCoord.y < 1.0) { color.gba = vec3(0.0); return; }
  color.g += vUv.x * 0.0001;
}
const float mipLevels[4] = float[4](0.0, 0.5, 1.0, 2.0);
${main}`
  material.uniforms.sampleFrame = new Uniform(0)
  const current = new WebGLArrayRenderTarget(1, 1, 1, { depthBuffer: false })
  const resolved = new WebGLArrayRenderTarget(1, 1, 1, { depthBuffer: false })
  current.texture.type = resolved.texture.type = HalfFloatType
  shadow.resolveMaterial.uniforms.inputBuffer.value = current.texture
  const readTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false })
  const readMaterial = new RawShaderMaterial({
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    uniforms: { source: { value: current.texture }, layer: { value: 0 } },
    vertexShader: material.vertexShader,
    fragmentShader: `precision highp float;precision highp sampler2DArray;
uniform sampler2DArray source;uniform int layer;
layout(location=0) out vec4 color;
void main(){color=texelFetch(source,ivec3(gl_FragCoord.xy,layer),0);}`
  })
  const readPass = new ShaderPass(readMaterial)
  let history: DataArrayTexture | undefined, binding: ReturnType<typeof prepareCloudShadowOutput> | undefined
  const read = (target: WebGLArrayRenderTarget): Uint16Array[] => {
    readMaterial.uniforms.source.value = target.texture
    return Array.from({ length: target.depth }, (_, layer) => {
      readMaterial.uniforms.layer.value = layer
      readMaterial.uniformsNeedUpdate = true
      readPass.render(renderer, null, readTarget)
      const pixels = new Uint16Array(target.width * target.height * 4)
      renderer.readRenderTargetPixels(readTarget, 0, 0, target.width, target.height, pixels)
      return pixels
    })
  }
  const render = (frame: number, splitCurrent = false): Uint16Array[] => {
    material.uniforms.sampleFrame.value = frame
    const gl = renderer.getContext(),
      originalDraw = gl.drawArrays
    let draws = 0
    gl.drawArrays = function (...args) {
      draws++
      return originalDraw.apply(this, args)
    }
    try {
      shadow.currentPass.render(renderer, null, current)
      shadow.resolvePass.render(renderer, null, resolved)
    } finally {
      gl.drawArrays = originalDraw
    }
    if (splitCurrent)
      check(draws === resolved.depth * 3, 'one current, paired unpack and resolve draw per shadow cascade')
    return [...read(current), ...read(resolved)]
  }
  try {
    for (const [width, height] of [
      [7, 5],
      [13, 9]
    ]) {
      for (const count of [1, 2, 3, 4]) {
        shadow.setSize(width, height, count)
        current.setSize(width, height, count * 2)
        resolved.setSize(width, height, count)
        readTarget.setSize(width, height)
        history?.dispose()
        history = new DataArrayTexture(new Float32Array(width * height * count * 4).fill(0.125), width, height, count)
        history.type = FloatType
        history.needsUpdate = true
        shadow.resolveMaterial.uniforms.historyBuffer.value = history
        const ordinary = [0, 1].map((frame) => render(frame))
        for (const splitCurrent of [true, false]) {
          binding = prepareCloudShadowOutput(shadow, undefined, { splitCurrent })
          for (const frame of [0, 1]) {
            render(frame, splitCurrent).forEach((pixels, layer) => {
              const reference = ordinary[frame][layer]
              // The pinned vec3 velocity output does not define its fourth channel.
              const velocity = layer >= count && layer < count * 2
              const mismatch = pixels.findIndex(
                (value, index) => !(velocity && index % 4 === 3) && value !== reference[index]
              )
              check(
                mismatch === -1,
                `shadow half-float parity ${width}x${height}, ${count} cascades, split current ${splitCurrent}, frame ${frame}, layer ${layer}, component ${mismatch}: ${pixels[mismatch]} != ${reference[mismatch]}`
              )
            })
          }
          binding.dispose()
          binding = undefined
          check(renderer.getContext().getError() === 0, 'original/single shadow target reuse has no GL errors')
        }
      }
    }
  } finally {
    renderer.setRenderTarget(previous)
    binding?.dispose()
    restoreTargets()
    effect.dispose()
    history?.dispose()
    current.dispose()
    resolved.dispose()
    readPass.dispose()
    readTarget.dispose()
  }
  check(renderer.info.memory.textures === baseline, 'shadow scratch and fixture textures released after repeated setup')
}
