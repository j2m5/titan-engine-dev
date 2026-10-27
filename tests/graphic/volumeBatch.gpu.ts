import { BasicDepthPacking, Color, DataUtils, DepthTexture, HalfFloatType, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Texture, UnsignedIntType, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { DepthCopyPass } from 'postprocessing'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'
import { DepthVolumePass } from '@/core/graphic/passes/DepthVolumePass'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { LensFrontPass } from '@/core/graphic/passes/LensFrontPass'
import type { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'

/** Exact HDR/depth parity across overlapping proxy edges, opaque occluders and moving views. */
export function checkVolumeBatch(front = false): unknown {
  const width = 63, height = 47
  const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
  renderer.setSize(width, height)
  renderer.autoClear = false
  const gl = renderer.getContext() as WebGL2RenderingContext
  const camera = new PerspectiveCamera(55, width / height, 0.1, 100)
  const scene = new Scene()
  const opaque = new Mesh(new PlaneGeometry(1.2, 1.1), new MeshBasicMaterial({ color: new Color(2.5, 0.3, 0.1) }))
  opaque.position.set(-0.12, 0.05, 0.3)
  scene.add(opaque)
  const registry = new DepthVolumeRegistry()
  const parent = new Object3D()
  parent.position.set(0.1, -0.1, 0)
  parent.rotation.z = 0.21
  scene.add(parent)
  const volumes = [0, 1, 2].map(index => {
    const material = new ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { depthCopy: { value: null }, resolution: { value: new Vector2(width, height) }, tint: { value: new Vector3() } },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D depthCopy; uniform vec2 resolution; uniform vec3 tint;
        void main() { vec2 uv = gl_FragCoord.xy / resolution;
          float depth = texture2D(depthCopy, uv).r;
          gl_FragColor = vec4(tint * (0.4 + uv.x) * (0.2 + depth), 0.37 + 0.1 * uv.y);
        }`
    })
    const volume = Object.assign(new Mesh(new PlaneGeometry(2.3, 2), material), {
      supportsDepthVolumeBatch: false,
      bindSceneDepth(texture: Texture) { material.uniforms.depthCopy.value = texture },
      unbindSceneDepth() { material.uniforms.depthCopy.value = null }
    })
    volume.name = `volume-${index}`
    volume.layers.set(DEPTH_VOLUME_LAYER)
    volume.frustumCulled = false
    // Adversarial renderOrder must not override DepthVolumePass's far-to-near ordering.
    volume.renderOrder = -index
    volume.position.set(index * 0.22, index * 0.07, -0.6 + index * 0.15)
    volume.rotation.z = index * 0.17
    volume.onBeforeRender = (_renderer, root) => {
      if ((root as Object3D) !== volume || volume.parent !== parent) throw new Error('Batch changed callback root or parent')
      material.uniforms.tint.value.set(0.5 + index, 1.8 - index * 0.3, 0.4 + index * 0.2)
    }
    parent.add(volume)
    registry.register(volume)
    return volume
  })
  const results: unknown[] = []
  const originalBlit = gl.blitFramebuffer
  let blits = 0
  gl.blitFramebuffer = function (...args) { blits++; return originalBlit.apply(this, args) }
  try {
    for (const samples of [0, 4, 8]) {
      const depth = new DepthTexture(width, height, UnsignedIntType)
      const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, depthTexture: depth, samples })
      const pass = front ? new LensFrontPass(scene, camera, {
        frontObjects: () => [], frontVolumes: () => registry.volumes(), restore() {}
      } as unknown as LensFrontSorter) : new DepthVolumePass(camera, registry)
      const copy = new DepthCopyPass({ depthPacking: BasicDepthPacking })
      pass.initialize(renderer, true, HalfFloatType); pass.setSize(width, height); pass.setDepthTexture(depth)
      copy.initialize(renderer, true, HalfFloatType); copy.setSize(width, height); copy.setDepthTexture(depth)
      const readDepth = () => {
        copy.render(renderer, target, null)
        const result = new Float32Array(width * height * 4)
        renderer.readRenderTargetPixels((copy as unknown as { renderTarget: WebGLRenderTarget }).renderTarget, 0, 0, width, height, result)
        return result
      }
      const render = (batch: boolean) => {
        volumes.forEach(volume => { volume.supportsDepthVolumeBatch = batch })
        renderer.setRenderTarget(target)
        renderer.setClearColor(new Color(0.03, 0.04, 0.08), 1)
        renderer.clear()
        renderer.render(scene, camera)
        const actualSamples = gl.getParameter(gl.SAMPLES) as number
        const beforeDepth = readDepth()
        blits = 0
        pass.render(renderer, target, null)
        const resolves = blits
        const hdr = new Uint16Array(width * height * 4)
        renderer.readRenderTargetPixels(target, 0, 0, width, height, hdr)
        const afterDepth = readDepth()
        if (beforeDepth.some((value, i) => value !== afterDepth[i])) throw new Error('Volume draw changed depth')
        if (hdr.some(value => !Number.isFinite(DataUtils.fromHalfFloat(value)))) throw new Error('Nonfinite HDR')
        if (!hdr.some(value => DataUtils.fromHalfFloat(value) > 1)) throw new Error('Fixture has no HDR signal')
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Volume batch WebGL error')
        return { hdr, depth: afterDepth, resolves, actualSamples }
      }
      try {
        for (const angle of [0, 0.27]) {
          camera.position.set(Math.sin(angle) * 3, 0.1, Math.cos(angle) * 3)
          camera.lookAt(0, 0, 0)
          const before = render(false), candidate = render(true), after = render(false)
          for (const [name, actual] of [['candidate', candidate], ['control', after]] as const) {
            if (before.hdr.some((value, i) => value !== actual.hdr[i])) throw new Error(`${name} HDR differs at samples=${samples}, angle=${angle}`)
            if (before.depth.some((value, i) => value !== actual.depth[i])) throw new Error(`${name} depth differs`)
          }
          const expected = samples ? 1 : 0
          if (candidate.resolves !== expected || before.resolves !== (samples ? 3 : 0)) {
            throw new Error(`MSAA resolves: ${JSON.stringify({ samples, baseline: before.resolves, candidate: candidate.resolves, expected })}`)
          }
          results.push({ front, samples, actualSamples: candidate.actualSamples, angle, baselineResolves: before.resolves, candidateResolves: candidate.resolves, hdrDifferences: 0, depthDifferences: 0 })
        }
      } finally {
        renderer.setRenderTarget(null)
        pass.dispose(); copy.dispose(); target.dispose(); depth.dispose()
      }
    }
    return results
  } finally {
    gl.blitFramebuffer = originalBlit
    for (const volume of volumes) { volume.geometry.dispose(); volume.material.dispose() }
    opaque.geometry.dispose(); opaque.material.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
