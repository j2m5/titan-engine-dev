import {
  Color, DataTexture, DataUtils, FloatType, HalfFloatType, Mesh, NoBlending, PerspectiveCamera, RepeatWrapping,
  RGBAFormat, ShaderMaterial, SphereGeometry, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'

const WIDTH = 31, HEIGHT = 23
const shadowAccumulation = /\/\/ Тень планеты и самозатенение слоя кольца — на каждом шаге[\s\S]*?(?=\s*#ifdef DUST_LIGHT_AT_ORIGIN)/

/** Compare the real material with its original shadow accumulation. Instrumented
 * draws separately prove that disabled shadows are not evaluated; pixel parity
 * alone cannot catch a regression that merely restores the expensive path. */
export function checkDustShadowFastPath() {
  const renderer = new WebGLRenderer()
  renderer.setSize(WIDTH, HEIGHT)
  renderer.setClearColor(new Color(0.13, 0.21, 0.34), 1)
  const gl = renderer.getContext()
  const camera = new PerspectiveCamera(65, WIDTH / HEIGHT, 0.1, 100)
  camera.position.set(7, 0.5, 5)
  camera.lookAt(-7, 0, -5)
  camera.updateMatrixWorld(true)
  const geometry = new SphereGeometry(14, 32, 16)
  const mesh = new Mesh(geometry)
  mesh.frustumCulled = false
  const profiles = new DataTexture(Float32Array.from({ length: 32 }, (_, i) =>
    i % 4 === 3 ? (Math.floor(i / 4) % 4) * 0.3 : 0.4 + (Math.floor(i / 4) % 3) * 0.2), 8, 1, RGBAFormat, FloatType)
  profiles.wrapS = RepeatWrapping
  profiles.needsUpdate = true
  const depthPixels = new Float32Array(WIDTH * HEIGHT * 4).fill(1)
  const depth = new DataTexture(depthPixels, WIDTH, HEIGHT, RGBAFormat, FloatType)
  depth.needsUpdate = true
  const countTarget = new WebGLRenderTarget(WIDTH, HEIGHT, { type: FloatType, depthBuffer: false })
  const outputs = [
    new WebGLRenderTarget(WIDTH, HEIGHT, { type: FloatType, depthBuffer: false }),
    new WebGLRenderTarget(WIDTH, HEIGHT, { type: HalfFloatType, samples: 4 })
  ]
  const results: { clumps: boolean; extinction: boolean; samples: number; radius: number; band: number; debug: number; depthMode: string; shadowCalls: number; covered: number }[] = []
  const materials: ShaderMaterial[] = []
  const read = (target: WebGLRenderTarget): Float32Array | Uint16Array => {
    const pixels = target.texture.type === FloatType ? new Float32Array(WIDTH * HEIGHT * 4) : new Uint16Array(WIDTH * HEIGHT * 4)
    renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels)
    if (gl.getError() !== gl.NO_ERROR) throw new Error('Dust shadow readback error')
    return pixels
  }
  const render = (material: ShaderMaterial, target: WebGLRenderTarget): Float32Array | Uint16Array => {
    renderer.setRenderTarget(target)
    mesh.material = material
    renderer.render(mesh, camera)
    return read(target)
  }
  try {
    for (const [clumps, extinction] of [[true, true], [true, false], [false, false]]) {
      const actual = new RingDustRaymarchMaterial(undefined, { clumps, extinction, lightAtOrigin: true, phaseHG: true, arcs: true })
      materials.push(actual)
      const u = actual.uniforms
      u.uDustCamRingPos.value.copy(camera.position)
      u.uDustLightDirRing.value.set(0.3, 0.4, 0.8).normalize()
      u.uDustDensity.value = 0.3
      u.uDustScaleHeight.value = 1.5
      u.uDustRingInner.value = 4
      u.uDustRingOuter.value = 12
      u.uDustNearFade.value = 2
      u.uDustClumpStrength.value = 0.6
      u.uDustClumpScale.value = 3
      u.uDustPhaseStrength.value = 0.6
      u.uDustExtinction.value = 0.5
      u.uDustRadialMap.value = profiles
      u.uDustRadialMapScale.value = 1
      u.uDustAngularMap.value = profiles
      u.uDustAngularMapScale.value = 1
      u.uRingBandMap.value = profiles
      u.uLayerHalfThickness.value = 1
      u.uLayerShadowStrength.value = 0.7
      u.uSceneDepth.value = depth
      u.uResolution.value.set(WIDTH, HEIGHT)
      u.uLogFarFactor.value = Math.log2(camera.far + 1)
      const variant = (fragmentShader: string): ShaderMaterial => {
        const material = new ShaderMaterial({ uniforms: u, defines: { ...actual.defines }, vertexShader: actual.vertexShader, fragmentShader,
          side: actual.side, transparent: actual.transparent, depthTest: actual.depthTest, depthWrite: actual.depthWrite,
          blending: actual.blending, blendSrc: actual.blendSrc, blendDst: actual.blendDst, blendEquation: actual.blendEquation,
          blendSrcAlpha: actual.blendSrcAlpha, blendDstAlpha: actual.blendDstAlpha, blendEquationAlpha: actual.blendEquationAlpha })
        materials.push(material)
        return material
      }
      if (!shadowAccumulation.test(actual.fragmentShader)) throw new Error('Missing original dust shadow reference boundary')
      const reference = variant(actual.fragmentShader.replace(shadowAccumulation,
        'litTau += contrib * ringDustPlanetShadow(p) * ringLayerShadow(p);'))
      const instrumented = variant('float shadowCallCount = 0.0;\n' + actual.fragmentShader
        .replace('float ringDustPlanetShadow(vec3 p) {', 'float ringDustPlanetShadow(vec3 p) { shadowCallCount += 1.0;')
        .replace('float ringLayerShadow(vec3 p) {', 'float ringLayerShadow(vec3 p) { shadowCallCount += 1.0;')
        .replace('void main()', 'void dustMain()') +
        '\nvoid main() { dustMain(); gl_FragColor = vec4(shadowCallCount, 0.0, 0.0, 1.0); }')
      // Count calls without blending or an opaque clear color contaminating zero.
      instrumented.blending = NoBlending
      const cases: { radius: number; band: number; debug?: number; depthMode?: string }[] = [
        { radius: 0, band: 0 }, { radius: -1, band: 0.499 },
        { radius: 2, band: 0 }, { radius: 0, band: 0.5 }, { radius: 2, band: 1 },
        { radius: 0, band: 0, debug: 1 }, { radius: 2, band: 1, debug: 2 }, { radius: 0, band: 0, debug: 3 },
        { radius: 0, band: 0, debug: 4 }, { radius: 0, band: 0, depthMode: 'sky' }, { radius: 0, band: 0, depthMode: 'occluded' }
      ]
      const version = actual.version
      for (const output of outputs) {
        let resources: { programs: number; textures: number } | undefined
        for (const [index, shadow] of cases.entries()) {
          u.uDustPlanetRadius.value = shadow.radius
          u.uRingBandEnabled.value = shadow.band
          const debug = shadow.debug ?? 0
          u.uDustDebugMode.value = debug
          const depthMode = shadow.depthMode ?? (index % 2 ? 'mixed' : 'off')
          u.uSceneDepthEnabled.value = depthMode === 'off' ? 0 : 1
          for (let i = 0; i < depthPixels.length; i += 4) depthPixels[i] = depthMode === 'occluded' ? 0 :
            depthMode !== 'mixed' || (i / 4) % 3 ? 1 : Math.log2(5) / u.uLogFarFactor.value
          depth.needsUpdate = true
          renderer.setClearColor(new Color(0.13, 0.21, 0.34), 1)
          const expected = render(reference, output), found = render(actual, output)
          if (found.some((value, i) => !Number.isFinite(found instanceof Uint16Array ? DataUtils.fromHalfFloat(value) : value) || value !== expected[i])) {
            throw new Error(`Dust shadow HDR differs: ${JSON.stringify({ clumps, extinction, shadow, debug, samples: output.samples })}`)
          }
          renderer.setClearColor(0, 0)
          const counts = render(instrumented, countTarget)
          let shadowCalls = 0, covered = 0
          for (let i = 0; i < counts.length; i += 4) if (counts[i + 3]) { covered++; shadowCalls += counts[i] }
          if (depthMode === 'occluded' ? covered !== 0 : !covered) throw new Error('Dust shadow fixture has incorrect depth coverage')
          const skip = clumps && shadow.radius <= 0 && shadow.band < 0.5
          const noCalls = skip || depthMode === 'occluded'
          if (noCalls ? shadowCalls !== 0 : shadowCalls <= 0) throw new Error(`Disabled shadow work: expected ${noCalls ? 'zero' : 'positive'} calls, received ${shadowCalls}`)
          results.push({ clumps, extinction, samples: output.samples, ...shadow, debug, depthMode, shadowCalls, covered })
          const current = { programs: renderer.info.programs?.length ?? 0, textures: renderer.info.memory.textures }
          if (resources && (resources.programs !== current.programs || resources.textures !== current.textures)) throw new Error('Dust shadow toggles grew GPU resources')
          resources = current
        }
      }
      if (actual.version !== version) throw new Error('Dust shadow toggles recompiled the material')
    }
    return { width: WIDTH, height: HEIGHT, comparisons: results.length, bitIdentical: true, results }
  } finally {
    renderer.setRenderTarget(null)
    materials.forEach(material => material.dispose())
    outputs.forEach(output => output.dispose())
    countTarget.dispose(); geometry.dispose(); profiles.dispose(); depth.dispose()
    renderer.dispose(); renderer.forceContextLoss()
  }
}
