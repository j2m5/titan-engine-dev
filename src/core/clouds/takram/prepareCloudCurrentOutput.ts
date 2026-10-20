import { ShaderPass } from 'postprocessing'
import {
  GLSL3,
  HalfFloatType,
  NearestFilter,
  NoBlending,
  RawShaderMaterial,
  RGBAIntegerFormat,
  UnsignedIntType,
  WebGLRenderTarget
} from 'three'
import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'
import { appendProgramCacheKey } from '@/core/graphic/effects/atmosphere/shaderCompilationScope'

const installed = new WeakSet<ShaderPass>()

function packedShader(source: string): string {
  for (const [from, to] of [
    ['layout(location = 0) out vec4 outputColor;', 'vec4 outputColor;'],
    ['layout(location = 1) out vec3 outputDepthVelocity;', 'vec3 outputDepthVelocity;'],
    ['void main() {', 'void sceneCloudCurrentMain() {']
  ])
    source = replaceExactlyOnce(source, from, to, 'scene cloud packed output', from)
  // The wrapper also exports early returns (clear rays and diagnostic views).
  return `precision highp int;\n${source}
layout(location = 0) out highp uvec4 sceneCloudPacked;
void main() {
  sceneCloudCurrentMain();
  sceneCloudPacked = uvec4(
    packHalf2x16(outputColor.rg), packHalf2x16(outputColor.ba),
    packHalf2x16(outputDepthVelocity.rg), packHalf2x16(vec2(outputDepthVelocity.b, 0.0))
  );
}`
}

class CloudOutputUnpackPass extends ShaderPass {
  public get warmupScene() {
    return this.scene
  }
}

/** ANGLE/D3D11 specializes MRT output layouts on first draw, after parallel linking.
 * Export the expensive march to one integer attachment and leave MRT specialization
 * to a tiny unpack pass. Public half-float textures and temporal resolve stay intact.
 */
export function prepareCloudCurrentOutput(pass: ShaderPass, programCacheKey?: string) {
  if (installed.has(pass)) throw new Error('Scene cloud packed output already installed')
  const material = pass.fullscreenMaterial
  if (!(material instanceof RawShaderMaterial) || material.glslVersion !== GLSL3)
    throw new Error('Unsupported scene cloud current material')
  if (material.defines.SHADOW_LENGTH !== undefined)
    throw new Error('Scene cloud packed output does not support shadow length')
  // Validate before publishing any hook or allocating owned resources.
  packedShader(material.fragmentShader)
  const originalCompile = material.onBeforeCompile,
    originalKey = material.customProgramCacheKey,
    originalRender = pass.render
  const packed = new WebGLRenderTarget(1, 1, {
    format: RGBAIntegerFormat,
    type: UnsignedIntType,
    internalFormat: 'RGBA32UI',
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthBuffer: false
  })
  packed.texture.name = 'SceneCloud.PackedCurrent'
  const unpackMaterial = new RawShaderMaterial({
    name: 'SceneCloud.UnpackCurrent',
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
    uniforms: { packedCloudBuffer: { value: packed.texture } },
    vertexShader: `precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `precision highp float;
precision highp int;
uniform highp usampler2D packedCloudBuffer;
layout(location = 0) out vec4 outputColor;
layout(location = 1) out vec3 outputDepthVelocity;
void main() {
  uvec4 data = texelFetch(packedCloudBuffer, ivec2(gl_FragCoord.xy), 0);
  outputColor = vec4(unpackHalf2x16(data.x), unpackHalf2x16(data.y));
  outputDepthVelocity = vec3(unpackHalf2x16(data.z), unpackHalf2x16(data.w).x);
}`
  })
  appendProgramCacheKey(unpackMaterial, programCacheKey)
  const unpack = new CloudOutputUnpackPass(unpackMaterial)
  material.onBeforeCompile = function (shader, renderer) {
    originalCompile.call(this, shader, renderer)
    shader.fragmentShader = packedShader(shader.fragmentShader)
  }
  material.customProgramCacheKey = function () {
    return `${originalKey.call(this)};${originalCompile.toString()};scene-cloud-packed-current-v1`
  }
  material.needsUpdate = true
  pass.render = function (renderer, input, output, delta, stencil) {
    if (!output || output.textures.length !== 2 || output.textures.some((texture) => texture.type !== HalfFloatType))
      throw new Error('Scene cloud packed output requires two half-float attachments')
    packed.setSize(output.width, output.height)
    originalRender.call(this, renderer, input, packed, delta, stencil)
    unpack.render(renderer, null, output)
  }
  installed.add(pass)
  let disposed = false
  return {
    warmupScene: unpack.warmupScene,
    dispose(): void {
      if (disposed) return
      disposed = true
      pass.render = originalRender
      material.onBeforeCompile = originalCompile
      material.customProgramCacheKey = originalKey
      material.needsUpdate = true
      installed.delete(pass)
      packed.dispose()
      unpack.dispose()
    }
  }
}
