import {
  DataTexture,
  Data3DTexture,
  DataArrayTexture,
  FloatType,
  RGBAFormat,
  NearestFilter,
  HalfFloatType,
  DataUtils,
  WebGLRenderer,
  WebGLRenderTarget,
  PerspectiveCamera,
  SphereGeometry,
  Mesh,
  Scene,
  Vector2,
  Vector3,
  Matrix4,
  NoToneMapping,
  SRGBColorSpace,
  type Texture,
  type ShaderMaterial
} from 'three'
import { EffectComposer, ShaderPass, EffectPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import { createEarthHdrBlendMaterial } from '@/labs/earth-clouds/earthHdrBlend'
import { EarthCloudComposer } from '@/labs/earth-clouds/EarthCloudComposer'
import { createEarthSurfaceMaterials } from '@/labs/earth-clouds/EarthSurfaceMaterial'
import { PlanetAerialPerspectiveEffect } from '@/labs/jupiter-clouds/planetDepth'
import type { EarthGpuProbeReport } from './gpuTestHarness'
import type { AtmosphereShadow } from '@takram/three-atmosphere'

export async function checkEarthComposition(): Promise<EarthGpuProbeReport> {
  const acquisition: (() => void)[] = []
  let cleanupStarted = false
  try {
    const renderer = new WebGLRenderer({ logarithmicDepthBuffer: true })
    acquisition.push(() => {
      renderer.dispose()
      renderer.forceContextLoss()
    })
    renderer.debug.onShaderError = (gl, p, v, f) => {
      throw new Error(
        `Composition shader compile: ${gl.getProgramInfoLog(p)} ${gl.getShaderInfoLog(v)} ${gl.getShaderInfoLog(f)}`
      )
    }
    renderer.toneMapping = NoToneMapping
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMappingExposure = 2
    renderer.setSize(1, 1, false)
    const owned: Texture[] = []
    acquisition.push(() => owned.forEach((t) => t.dispose()))
    const texture = (rgba: number[]) => {
      const t = new DataTexture(new Float32Array(rgba), 1, 1, RGBAFormat, FloatType)
      t.minFilter = t.magFilter = NearestFilter
      t.needsUpdate = true
      owned.push(t)
      return t
    }
    const farMap = texture([2, 0.25, 0.75, 1]),
      nearMap = texture([2, 0.25, 0.75, 1])
    const mix = createEarthHdrBlendMaterial(farMap, nearMap)
    const camera = new PerspectiveCamera(50, 1, 1, 100000)
    const linear = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      depthBuffer: false,
      multisampling: 0
    })
    acquisition.push(() => linear.dispose())
    linear.autoRenderToScreen = false
    linear.addPass(new ShaderPass(mix))
    const tone = new EffectComposer(renderer, { frameBufferType: HalfFloatType, depthBuffer: false, multisampling: 0 })
    acquisition.push(() => tone.dispose())
    tone.autoRenderToScreen = false
    const toneMix = createEarthHdrBlendMaterial(farMap, nearMap)
    tone.addPass(new ShaderPass(toneMix))
    tone.addPass(new EffectPass(camera, new ToneMappingEffect({ mode: ToneMappingMode.AGX })))
    const report: EarthGpuProbeReport = { name: 'earth-composition', checks: 0, maxError: 0, resourcesReleased: false }
    const read = (target: WebGLRenderTarget) => {
      const data = new Uint16Array(4)
      renderer.readRenderTargetPixels(target, 0, 0, 1, 1, data)
      const error = renderer.getContext().getError()
      if (error) throw new Error(`Composition GL error ${error}`)
      return Array.from(data, DataUtils.fromHalfFloat)
    }
    const check = (actual: number[], expected: number[], label: string, tolerance = 0.004) => {
      const error = Math.max(...expected.map((x, i) => Math.abs(actual[i] - x)))
      if (!Number.isFinite(error) || error > tolerance)
        throw new Error(`${label}: ${JSON.stringify({ actual, expected, error })}`)
      report.checks++
      report.maxError = Math.max(error, report.maxError)
    }
    const differs = (actual: number[], expected: number[], label: string) => {
      if (Math.max(...expected.slice(0, 3).map((x, i) => Math.abs(actual[i] - x))) < 0.02)
        throw new Error(`Negative control escaped: ${label}: ${JSON.stringify({ actual, expected })}`)
      report.checks++
    }
    const write = (map: DataTexture, rgba: number[]) => {
      ;(map.image.data as Float32Array).set(rgba)
      map.needsUpdate = true
    }
    const renderTone = (far: Texture, near: Texture, weight: number) => {
      toneMix.uniforms.farMap.value = far
      toneMix.uniforms.nearMap.value = near
      toneMix.uniforms.weight.value = weight
      tone.render(0)
      // ShaderPass swaps once; the second pass writes the original input target.
      return read(tone.inputBuffer)
    }
    const lut = texture([1, 1, 1, 1]),
      black = texture([0, 0, 0, 1])
    const noise = new Data3DTexture(new Uint8Array(4), 1, 1, 1)
    noise.needsUpdate = true
    owned.push(noise)
    const farAerial = new PlanetAerialPerspectiveEffect(camera, { transmittance: false, inscatter: false, sky: false })
    const nearAerial = new PlanetAerialPerspectiveEffect(camera, { transmittance: false, inscatter: false, sky: false })
    acquisition.push(() => {
      farAerial.dispose()
      nearAerial.dispose()
    })
    const pair = createEarthSurfaceMaterials({
      textures: { surface: lut, clouds: black, night: black, specular: black, dispose() {} },
      radiusMeters: 6360000,
      atmosphere: { bottomRadius: 6360, topRadius: 6420, sunAngularRadius: 0.004675 } as Parameters<
        typeof createEarthSurfaceMaterials
      >[0]['atmosphere'],
      lut: { transmittanceTexture: lut, irradianceTexture: lut },
      stbnTexture: noise,
      longitudeOffsetRadians: 0,
      shadowReferenceShader: nearAerial.getFragmentShader()
    })
    acquisition.push(() => pair.dispose())
    if (pair.volumeError) throw pair.volumeError
    const geometry = new SphereGeometry(6360000, 32, 16),
      planet = new Mesh(geometry, pair.far),
      scene = new Scene()
    acquisition.push(() => geometry.dispose())
    scene.add(planet)
    camera.position.set(0, 0, 6361000)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    pair.updateFrame({
      camera,
      planetMatrixWorld: new Matrix4(),
      worldToECEFMatrix: new Matrix4(),
      sunDirection: new Vector3(0, 0, 1),
      resolution: new Vector2(1, 1),
      frame: 0
    })
    // Preserve complete Task3 materials/log-depth path, instrument only final radiance.
    const setColor = (material: ShaderMaterial, rgb: string) => {
      const token = 'gl_FragColor = vec4(min(finalColor, vec3(4.0)), 1.0);'
      if (!material.fragmentShader.includes(token)) throw new Error('Surface output changed')
      material.fragmentShader = material.fragmentShader.replace(token, `gl_FragColor = vec4(${rgb}, 1.0);`)
      material.needsUpdate = true
    }
    setColor(pair.far, '2.0, 0.25, 0.75')
    setColor(pair.near, '0.0, 0.5, 4.0')
    const composer = new EarthCloudComposer({ renderer, camera, scene, planet, materials: pair, farAerial, nearAerial })
    acquisition.push(() => composer.dispose())
    const internals = composer as unknown as {
      farComposer: EffectComposer
      nearComposer: EffectComposer
      finalComposer: EffectComposer
      blendMaterial: ShaderMaterial
    }
    // Read the real final chain offscreen; no test-only production rendering API.
    internals.finalComposer.passes.at(-1)!.renderToScreen = false
    const overlay = texture([2, 0.25, 0.75, 1])
    let updates = 0
    const render = (weight: number) =>
      composer.render({
        requestedWeight: weight,
        cloudsEnabled: true,
        deltaSeconds: 0,
        updateVolume(input, dt) {
          if (input !== internals.nearComposer.inputBuffer || dt !== 0)
            throw new Error('Wrong volume input target/delta')
          updates++
          return { overlay: { map: overlay }, shadow: null }
        }
      })
    try {
      for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
        mix.uniforms.weight.value = weight
        linear.render(0)
        check(read(linear.outputBuffer), [2, 0.25, 0.75, 1], `equal HDR endpoints w=${weight}`)
      }
      write(nearMap, [0, 0.5, 4, 1])
      mix.uniforms.weight.value = 0.5
      linear.render(0)
      check(read(linear.outputBuffer), [1, 0.375, 2.375, 1], 'linear mean before tone mapping')
      const reference = texture([1, 0.375, 2.375, 1])
      const sharedTone = renderTone(farMap, nearMap, 0.5)
      check(sharedTone, renderTone(reference, reference, 0), 'one shared AGX pass at exposure 2')
      const mappedFar = renderTone(farMap, farMap, 0),
        mappedNear = renderTone(nearMap, nearMap, 0)
      differs(
        mappedFar.map((v, i) => (v + mappedNear[i]) / 2),
        sharedTone,
        'tone mapping each endpoint before mean'
      )
      write(nearMap, [99, 11, 7, 1])
      mix.uniforms.weight.value = 0
      linear.render(0)
      check(read(linear.outputBuffer), [2, 0.25, 0.75, 1], 'far endpoint ignores stale near')
      write(farMap, [77, 22, 13, 1])
      write(nearMap, [0, 0.5, 4, 1])
      mix.uniforms.weight.value = 1
      linear.render(0)
      check(read(linear.outputBuffer), [0, 0.5, 4, 1], 'near endpoint ignores stale far')
      render(0.5)
      check(read(internals.farComposer.outputBuffer), [2, 0.25, 0.75, 1], 'real far aerial outputBuffer')
      check(read(internals.nearComposer.outputBuffer), [2, 0.25, 0.75, 1], 'full opaque near overlay outputBuffer')
      check(
        read(internals.finalComposer.inputBuffer),
        renderTone(overlay, overlay, 0),
        'overlay receives transition weight once'
      )
      nearAerial.setCloudOpacity(0.5)
      planet.material = pair.near
      internals.nearComposer.render(0)
      planet.material = pair.far
      differs(read(internals.nearComposer.outputBuffer), [2, 0.25, 0.75, 1], 'half near opacity double weights overlay')
      internals.finalComposer.render(0)
      differs(
        read(internals.finalComposer.inputBuffer),
        renderTone(overlay, overlay, 0),
        'half near opacity changes final transition'
      )
      const farDepth = internals.farComposer.inputBuffer.depthTexture,
        nearDepth = internals.nearComposer.inputBuffer.depthTexture
      if (
        !farDepth ||
        !nearDepth ||
        farDepth === nearDepth ||
        internals.farComposer.outputBuffer.depthTexture ||
        internals.nearComposer.outputBuffer.depthTexture
      )
        throw new Error('Endpoint depth targets must be separate and read-only during aerial pass')
      report.checks++
      // Consecutive log-depth sphere frames and resized targets must never feedback.
      render(0.5)
      render(0.5)
      check(read(internals.nearComposer.outputBuffer), [2, 0.25, 0.75, 1], 'consecutive frames')
      renderer.setPixelRatio(2)
      renderer.setSize(2, 2, false)
      composer.setSize(2, 2)
      if (internals.nearComposer.inputBuffer.width !== 4 || internals.farComposer.outputBuffer.width !== 4)
        throw new Error('CSS/DPR resize mismatch')
      report.checks++
      render(0.5)
      render(0.5)
      check(read(internals.nearComposer.outputBuffer), [2, 0.25, 0.75, 1], 'resized consecutive frames')
      const before = updates
      render(0)
      if (updates !== before || planet.material !== pair.far)
        throw new Error('Zero weight update/material restoration failed')
      check(read(internals.finalComposer.inputBuffer), renderTone(overlay, overlay, 0), 'actual far-only stale near')
      // Near-only must overwrite the previous near frame and ignore stale far output.
      write(overlay, [0, 0.5, 4, 1])
      render(1)
      check(read(internals.finalComposer.inputBuffer), renderTone(overlay, overlay, 0), 'actual near-only stale far')
      // Transparent overlay exercises the actual sphere depth consumer, rather than opaque early return.
      // White transmittance LUT makes attenuation neutral while keeping depth reconstruction live.
      for (const aerial of [farAerial, nearAerial]) {
        aerial.transmittanceTexture = lut
        aerial.transmittance = true
      }
      write(overlay, [0, 0, 0, 0])
      render(1)
      render(1)
      check(read(internals.nearComposer.outputBuffer), [0, 0.5, 4, 1], 'log depth sphere without overlay')
      composer.setSize(3, 3)
      render(0.5)
      render(0.5)
      check(read(internals.nearComposer.outputBuffer), [0, 0.5, 4, 1], 'resized log depth sphere without overlay')
      const shadowMap = new DataArrayTexture(new Float32Array([0, 1 / 8000, 1, 0]), 1, 1, 1)
      shadowMap.type = FloatType
      shadowMap.minFilter = shadowMap.magFilter = NearestFilter
      shadowMap.needsUpdate = true
      owned.push(shadowMap)
      const shadow: AtmosphereShadow = {
        map: shadowMap,
        mapSize: new Vector2(1, 1),
        cascadeCount: 1,
        intervals: [new Vector2(0, 1)],
        matrices: [new Matrix4().makeScale(0.001, 0.001, 0)],
        inverseMatrices: [new Matrix4()],
        far: 10000,
        topHeight: 8000
      }
      pair.near.fragmentShader = pair.near.fragmentShader.replace(
        'gl_FragColor = vec4(0.0, 0.5, 4.0, 1.0);',
        'gl_FragColor = vec4(vec3(directGain), 1.0);'
      )
      pair.near.needsUpdate = true
      for (const weight of [0.5, 1]) {
        composer.render({
          requestedWeight: weight,
          cloudsEnabled: true,
          deltaSeconds: 0,
          updateVolume: () => ({ overlay: { map: overlay }, shadow })
        })
        check(
          read(internals.nearComposer.outputBuffer),
          [0.367879, 0.367879, 0.367879, 1],
          `full material shadow at weight ${weight}`
        )
        if (nearAerial.shadow || nearAerial.shadowLength || farAerial.shadow || farAerial.overlay)
          throw new Error('Unexpected aerial cloud lighting')
        report.checks++
      }
      planet.material = pair.near
      const failure = new Error('synthetic volume failure')
      const fallback = composer.render({
        requestedWeight: 1,
        cloudsEnabled: true,
        deltaSeconds: 0,
        updateVolume() {
          throw failure
        }
      })
      if (
        fallback.effectiveWeight !== 0 ||
        fallback.volumeError !== failure ||
        planet.material !== pair.near ||
        nearAerial.overlay ||
        pair.near.uniforms.earthShadowEnabled.value
      )
        throw new Error('Actual composer fallback failed to clear/restore')
      check(read(internals.farComposer.outputBuffer), [2, 0.25, 0.75, 1], 'actual fresh far fallback')
      composer.render({
        requestedWeight: 0.5,
        cloudsEnabled: false,
        deltaSeconds: 0,
        updateVolume() {
          throw new Error('disabled update')
        }
      })
      if (pair.far.uniforms.earthSurfaceMapEnabled.value || planet.material !== pair.near)
        throw new Error('Disabled map/material restoration failed')
      report.checks++
    } finally {
      cleanupStarted = true
      composer.dispose()
      linear.dispose()
      tone.dispose()
      pair.dispose()
      geometry.dispose()
      owned.forEach((t) => t.dispose())
      renderer.setRenderTarget(null)
      report.resourcesReleased = renderer.info.memory.textures === 0 && renderer.info.memory.geometries === 0
      renderer.dispose()
      renderer.forceContextLoss()
    }
    if (!report.resourcesReleased) throw new Error('Composition resources leaked')
    return report
  } finally {
    if (!cleanupStarted) for (const release of acquisition.reverse()) release()
  }
}
