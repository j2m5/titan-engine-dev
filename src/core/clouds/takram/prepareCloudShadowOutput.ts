import type { CloudsEffect } from '@takram/three-clouds'
import { ShaderPass } from 'postprocessing'
import {
  GLSL3,
  HalfFloatType,
  NearestFilter,
  NoBlending,
  RawShaderMaterial,
  RGBAIntegerFormat,
  Uniform,
  UnsignedIntType,
  WebGLArrayRenderTarget,
  WebGLRenderTarget,
  type WebGLRenderer
} from 'three'
import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'
import { appendProgramCacheKey } from '@/core/graphic/effects/atmosphere/shaderCompilationScope'

const installed = new WeakSet<CloudsEffect['shadowPass']>()
const CASCADE = 'sceneCloudShadowCascade'

function singleOutputShader(source: string, current: boolean): string {
  const replace = (anchor: string | RegExp, value: string, point: string): void => {
    source = replaceExactlyOnce(source, anchor, value, 'scene cloud shadow output', point)
  }
  if (current) {
    replace(
      /layout\(location = 0\) out vec4 outputColor\[CASCADE_COUNT\];[\s\S]*?#endif \/\/ CASCADE_COUNT/,
      'vec4 outputColor[CASCADE_COUNT];\nvec3 outputDepthVelocity[CASCADE_COUNT];',
      'current output declarations'
    )
  } else {
    replace(
      'layout(location = 0) out vec4 outputColor[CASCADE_COUNT];',
      'vec4 outputColor[CASCADE_COUNT];',
      'resolve output declaration'
    )
  }
  // Keep the original body, including any diagnostic injection, compilable.
  // Only the new entry point exports a framebuffer output.
  replace('void main() {', 'void sceneCloudShadowOriginalMain() {', 'entry point')
  return `precision highp int;\n${source}
uniform int ${CASCADE};
${
  current
    ? `layout(location = 0) out highp uvec4 sceneCloudShadowPacked;
void main() {
  vec4 color;
  vec3 depthVelocity;
  cascade(${CASCADE}, mipLevels[${CASCADE}], color, depthVelocity);
  sceneCloudShadowPacked = uvec4(packHalf2x16(color.rg), packHalf2x16(color.ba),
    packHalf2x16(depthVelocity.rg), packHalf2x16(vec2(depthVelocity.b, 0.0)));
}`
    : `layout(location = 0) out vec4 sceneCloudShadowResolved;
void main() { cascade(${CASCADE}, sceneCloudShadowResolved); }`
}
`
}

class ShadowOutputDraw extends ShaderPass {
  public get warmupScene() {
    return this.scene
  }

  public draw(renderer: WebGLRenderer, target: WebGLRenderTarget, layer = 0): void {
    renderer.setRenderTarget(target, layer)
    renderer.render(this.scene, this.camera)
  }
}

function selectSingleAttachment(
  renderer: WebGLRenderer,
  target: WebGLArrayRenderTarget,
  limits: WeakMap<WebGL2RenderingContext, number>
): void {
  renderer.setRenderTarget(target)
  const gl = renderer.getContext()
  if (!('framebufferTextureLayer' in gl)) throw new Error('Scene cloud shadows require WebGL2')
  let limit = limits.get(gl)
  if (limit === undefined) {
    limit = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number
    limits.set(gl, limit)
  }
  // A target previously used by ShaderArrayPass may still have its other layers
  // attached. Rebinding layer 0 to any of them would make the framebuffer invalid.
  for (let slot = 1; slot < Math.min(target.depth, limit); slot++)
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + slot, null, 0, 0)
  gl.drawBuffers([gl.COLOR_ATTACHMENT0])
}

/** Avoid first-draw MRT specialization of the heavy shadow kernels. Each cascade
 * retains its original coordinates and math; a single scratch texture is reused.
 */
export function prepareCloudShadowOutput(
  shadow: CloudsEffect['shadowPass'],
  programCacheKey?: string,
  { splitCurrent = true }: { splitCurrent?: boolean } = {}
) {
  if (installed.has(shadow)) throw new Error('Scene cloud shadow output already installed')
  const materials = [shadow.currentMaterial, shadow.resolveMaterial]
  materials.forEach((material, index) => {
    if (index === 0 && !splitCurrent) return
    if (!(material instanceof RawShaderMaterial) || material.glslVersion !== GLSL3 || CASCADE in material.uniforms)
      throw new Error('Unsupported scene cloud shadow material')
    singleOutputShader(material.fragmentShader, index === 0)
  })
  if (!shadow.temporalPass) throw new Error('Scene cloud shadow output requires temporal shadows')
  const hooks = materials.map((material) => ({
    compile: material.onBeforeCompile,
    key: material.customProgramCacheKey
  }))
  const renders = [shadow.currentPass.render, shadow.resolvePass.render]
  const indices = [new Uniform(0), new Uniform(0)]
  const attachmentLimits = new WeakMap<WebGL2RenderingContext, number>()
  const packed = new WebGLRenderTarget(1, 1, {
    format: RGBAIntegerFormat,
    type: UnsignedIntType,
    internalFormat: 'RGBA32UI',
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false
  })
  packed.texture.name = 'SceneCloud.PackedShadow'
  const unpackMaterial = new RawShaderMaterial({
    name: 'SceneCloud.UnpackShadow',
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    uniforms: { packedShadow: { value: packed.texture }, channel: { value: 0 } },
    vertexShader: 'precision highp float;in vec3 position;void main(){gl_Position=vec4(position,1.0);}',
    fragmentShader: `precision highp float;precision highp int;
uniform highp usampler2D packedShadow;
uniform int channel;
layout(location = 0) out vec4 color;
void main() {
  uvec4 p = texelFetch(packedShadow, ivec2(gl_FragCoord.xy), 0);
  color = channel == 0 ? vec4(unpackHalf2x16(p.x), unpackHalf2x16(p.y)) :
    vec4(unpackHalf2x16(p.z), unpackHalf2x16(p.w).x, 0.0);
}`
  })
  appendProgramCacheKey(unpackMaterial, programCacheKey)
  const unpack = new ShadowOutputDraw(unpackMaterial)
  const draws = materials.map((material) => new ShadowOutputDraw(material))
  materials.forEach((material, index) => {
    if (index === 0 && !splitCurrent) return
    material.uniforms[CASCADE] = indices[index]
    material.onBeforeCompile = function (shader, renderer) {
      hooks[index].compile.call(this, shader, renderer)
      shader.fragmentShader = singleOutputShader(shader.fragmentShader, index === 0)
    }
    material.customProgramCacheKey = function () {
      return `${hooks[index].key.call(this)};${hooks[index].compile.toString()};scene-cloud-single-shadow-v3-${index}`
    }
    material.needsUpdate = true
  })
  const cascadeCount = (output: WebGLArrayRenderTarget, current: boolean): number => {
    const count = Number(materials[current ? 0 : 1].defines.CASCADE_COUNT)
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      count > 4 ||
      !(output instanceof WebGLArrayRenderTarget) ||
      output.texture.type !== HalfFloatType ||
      output.depth !== count * (current ? 2 : 1)
    )
      throw new Error('Scene cloud shadow output requires matching half-float cascade layers')
    return count
  }
  if (splitCurrent)
    shadow.currentPass.render = function (renderer, _input, output) {
      const count = cascadeCount(output, true)
      selectSingleAttachment(renderer, output, attachmentLimits)
      packed.setSize(output.width, output.height)
      for (let cascade = 0; cascade < count; cascade++) {
        indices[0].value = cascade
        materials[0].uniformsNeedUpdate = true
        draws[0].draw(renderer, packed)
        for (let channel = 0; channel < 2; channel++) {
          unpackMaterial.uniforms.channel.value = channel
          unpackMaterial.uniformsNeedUpdate = true
          unpack.draw(renderer, output, cascade + channel * count)
        }
      }
    }
  shadow.resolvePass.render = function (renderer, _input, output) {
    const count = cascadeCount(output, false)
    selectSingleAttachment(renderer, output, attachmentLimits)
    for (let cascade = 0; cascade < count; cascade++) {
      indices[1].value = cascade
      materials[1].uniformsNeedUpdate = true
      draws[1].draw(renderer, output, cascade)
    }
  }
  installed.add(shadow)
  let disposed = false
  return {
    warmupScene: unpack.warmupScene,
    dispose(): void {
      if (disposed) return
      disposed = true
      shadow.currentPass.render = renders[0]
      shadow.resolvePass.render = renders[1]
      materials.forEach((material, index) => {
        if (index === 0 && !splitCurrent) {
          draws[index].warmupScene.clear()
          return
        }
        material.onBeforeCompile = hooks[index].compile
        material.customProgramCacheKey = hooks[index].key
        delete material.uniforms[CASCADE]
        material.needsUpdate = true
        // These scenes borrow the pinned material and shared fullscreen geometry.
        draws[index].warmupScene.clear()
      })
      installed.delete(shadow)
      packed.dispose()
      unpack.dispose()
    }
  }
}
