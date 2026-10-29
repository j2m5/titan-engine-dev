import { CloudsEffect } from '@takram/three-clouds'
import { DataUtils, HalfFloatType, PerspectiveCamera, WebGLArrayRenderTarget, type WebGLRenderer } from 'three'
import { prepareCloudShadowOutput } from '@/core/clouds/takram/prepareCloudShadowOutput'
import { prepareCloudTargets } from '@/core/clouds/takram/prepareCloudTargets'

/** Isolate the production ray setup without weather or temporal filtering hiding
 * invalid intervals. Full-march numerical parity is checked in the live scene. */
export function checkSceneCloudShadowNumerics(
  renderer: WebGLRenderer,
  source: string,
  check: (condition: boolean, label: string) => void
): void {
  const previous = renderer.getRenderTarget(),
    baseline = renderer.info.memory.textures
  const effect = new CloudsEffect(new PerspectiveCamera()),
    shadow = effect.shadowPass
  const restoreTargets = prepareCloudTargets(effect)
  const material = shadow.currentMaterial
  const march = 'vec4 color = marchClouds(rayOrigin, rayDirection, rayFar - rayNear, stbn, mipLevel);'
  check(source.split(march).length === 2, 'unique production shadow march for ray isolation')
  material.fragmentShader = source.replace(march, 'vec4 color = vec4(rayNear, rayFar, rayFar - rayNear, 1.0);')
  shadow.setSize(1, 1, 1)
  const uniforms = material.uniforms
  uniforms.bottomRadius.value = 4194304
  uniforms.shadowTopHeight.value = 8192
  uniforms.shadowBottomHeight.value = 4096
  uniforms.sunDirection.value.set(0, 0, 1)
  material.needsUpdate = true
  const target = new WebGLArrayRenderTarget(1, 1, 2, { depthBuffer: false })
  target.texture.type = HalfFloatType
  const gl = renderer.getContext() as WebGL2RenderingContext,
    framebuffer = gl.createFramebuffer()
  let binding: ReturnType<typeof prepareCloudShadowOutput> | undefined
  const read = (layer: number): number[] => {
    const previousRead = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    const texture = (renderer.properties.get(target.texture) as { __webglTexture: WebGLTexture }).__webglTexture
    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer)
      gl.framebufferTextureLayer(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, 0, layer)
      gl.readBuffer(gl.COLOR_ATTACHMENT0)
      check(
        gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE,
        'shadow ray read target complete'
      )
      const values = new Uint16Array(4)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.HALF_FLOAT, values)
      return Array.from(values, DataUtils.fromHalfFloat)
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead)
    }
  }
  try {
    for (const packed of [false, true]) {
      if (packed) binding = prepareCloudShadowOutput(shadow)
      for (const [height, expected] of [
        [16384, [8192, 12288, 4096, 1]],
        [6144, [0, 2048, 2048, 1]],
        [Number.NaN, [0, 0, 0, 0]]
      ] as const) {
        // The vertex uses clip z=-1, so translation includes one extra metre.
        uniforms.inverseShadowMatrices.value[0].makeTranslation(0, 0, 4194304 + height + 1)
        shadow.currentPass.render(renderer, null, target)
        const actual = read(0)
        check(
          actual.every((value, i) => value === expected[i]),
          `shadow ray interval packed=${packed}, height=${height}: ${actual} != ${expected}`
        )
        if (Number.isNaN(height))
          check(
            read(1)
              .slice(0, 3)
              .every((value) => value === 0),
            'invalid shadow ray has neutral velocity'
          )
      }
      binding?.dispose()
      binding = undefined
    }
    check(gl.getError() === 0, 'shadow ray GPU checks have no GL errors')
  } finally {
    renderer.setRenderTarget(previous)
    binding?.dispose()
    restoreTargets()
    effect.dispose()
    target.dispose()
    gl.deleteFramebuffer(framebuffer)
  }
  check(renderer.info.memory.textures === baseline, 'shadow ray fixture resources released')
}
