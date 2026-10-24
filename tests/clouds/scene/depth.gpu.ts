import {
  Color,
  DataTexture,
  DoubleSide,
  FloatType,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget
} from 'three'
import type { Actor } from '@/core/models/Actor'
import { createRenderer } from '@/core/graphic/renderingFactories'
import { SceneCloudDepth } from '@/core/graphic/clouds/SceneCloudDepth'
import { captureCloudFrame, decodeSceneCloudDepth } from '@/core/clouds/scene/CloudFrame'
import { Planet } from '@/core/renderables/Planet'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import { SpaceScale } from '@/core/constants'
import type { SceneCloudProbeReport } from './probe'

// Only the model data is synthetic. Geometry builders, materials, renderer and depth service are production code.
function actor(): Actor {
  const empty = { first: () => undefined, isNotEmpty: () => false }
  return {
    getAttribute: (_key: string, fallback: unknown) => fallback,
    physicalObject: { getAttribute: (key: string) => (key === 'radius' ? 6371 : undefined) },
    renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 0, terrainLambert: 1 }) },
    children: { where: () => empty },
    resources: { where: () => empty, first: () => undefined }
  } as unknown as Actor
}
export async function run(): Promise<SceneCloudProbeReport> {
  const report: SceneCloudProbeReport = { name: 'depth', checks: 0, maxError: 0, resourcesReleased: false, cases: [] }
  const assert = (condition: boolean, label: string) => {
    if (!condition) throw Error(label)
    report.checks++
  }
  const unit = SpaceScale / 1000,
    radius = 6371000 * unit,
    size = 33
  for (const msaa of [false, true]) {
    const renderer = createRenderer({ logarithmicDepthBuffer: true, antialias: msaa }, 1)
    renderer.setSize(size, size)
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      throw Error(
        `depth shader: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`
      )
    }
    const scene = new Scene(),
      model = actor(),
      center = new Object3D()
    const camera = new PerspectiveCamera(55, 1, 1e-9, 1e9)
    const terrainMaterial = new TerrainMaterial(model),
      waterMaterial = new WaterMaterial(model)
    const owned: Array<{ dispose(): void }> = [terrainMaterial, waterMaterial]
    const makePatches = (height: number, material: TerrainMaterial | WaterMaterial): Mesh[] => {
      const field = new TerrainHeightField(
        { width: 16, height: 8, minMeters: height, maxMeters: height + 1, data: new Uint16Array(128) },
        6371,
        { ...MIDBAND_DEFAULTS, midbandStrength: 0 }
      )
      const index = buildPatchIndex(32)
      return Array.from({ length: 6 }, (_, face) => {
        const { geometry, center: patchCenter } = buildTerrainPatchGeometry(
          field,
          face,
          0,
          0,
          0,
          32,
          index,
          0,
          detailWrapFor({}),
          true
        )
        geometry.setAttribute('patchMorph', new InstancedBufferAttribute(new Float32Array([0]), 1))
        const mesh = new Mesh(geometry, material)
        mesh.position.copy(patchCenter)
        owned.push(geometry)
        scene.add(mesh)
        return mesh
      })
    }
    const seabed = makePatches(-2000, terrainMaterial)
    const water = makePatches(0, waterMaterial)
    const peak = makePatches(9000, terrainMaterial)
    peak.forEach((m) => (m.visible = false))
    const planet = new Planet(model)
    planet.visible = false
    scene.add(planet)
    owned.push(planet.geometry, planet.material)
    const foregroundMaterial = new MeshBasicMaterial({ side: DoubleSide })
    const foreground = new Mesh(new PlaneGeometry(radius, radius), foregroundMaterial)
    foreground.position.z = radius + 15000 * unit
    foreground.visible = false
    scene.add(foreground)
    owned.push(foreground.geometry, foregroundMaterial)
    const depth = new SceneCloudDepth(renderer, scene)
    const readTarget = new WebGLRenderTarget(size, size, { type: FloatType, depthBuffer: false })
    const readMaterial = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: { map: { value: null } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: 'uniform sampler2D map;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(map,vUv).r);}'
    })
    const readScene = new Scene(),
      readQuad = new Mesh(new PlaneGeometry(2, 2), readMaterial)
    readScene.add(readQuad)
    const rays = new Raycaster(),
      buffer = new Float32Array(size * size * 4)
    let serial = 0
    const frame = () =>
      captureCloudFrame(
        {
          actorId: 7,
          object: center,
          getSurface: () => center,
          datumRadiusMeters: 6371000,
          descriptor: { state: 'off', volume: null, far: null, qualityProfile: 'terrestrial', issues: [] },
          resourcePaths: new Map(),
          lightColor: new Color(1, 1, 1),
          lambert: 1
        },
        camera,
        new Vector2(size, size),
        ++serial,
        1 / 60
      )!
    const render = () => {
      const output = depth.render(frame())
      assert(output.serial === serial && output.sceneLogFarFactor === Math.log2(camera.far + 1), 'frame identity/far')
      readMaterial.uniforms.map.value = output.texture
      renderer.setRenderTarget(readTarget)
      renderer.render(readScene, camera)
      renderer.readRenderTargetPixels(readTarget, 0, 0, size, size, buffer)
      assert(renderer.getContext().getError() === 0, 'GL errors')
      return output
    }
    const compare = (x: number, y: number, objects: Object3D[], output: ReturnType<typeof render>) => {
      const ndc = new Vector2(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1)
      rays.setFromCamera(ndc, camera)
      const hit = rays.intersectObjects(objects, false)[0]
      const raw = buffer[(y * size + x) * 4]
      const cosine = -rays.ray.direction.clone().applyQuaternion(camera.quaternion.clone().invert()).z
      const actual = decodeSceneCloudDepth(raw, output.sceneLogFarFactor, output.sceneUnitsToMeters, cosine)
      if (!hit) {
        assert(actual === Infinity, `background ${x},${y}: ${raw}`)
        return
      }
      const expected = hit.distance / unit
      const error = Math.abs(actual - expected) / expected
      report.maxError = Math.max(report.maxError, error)
      assert(error <= 1e-3, `distance ${x},${y}: ${actual} vs ${expected} (${error}), MSAA=${msaa}`)
    }
    try {
      for (const altitude of [20000, 5000, 2000]) {
        camera.position.set(0, 0, radius + altitude * unit)
        camera.lookAt(0, 0, 0)
        camera.updateMatrixWorld()
        // Fractions correspond to low/medium cloud ray jitter, via the real camera view-offset projection.
        for (const jitter of [0, 0.25, -0.375]) {
          camera.setViewOffset(size, size, jitter, jitter, size, size)
          const output = render()
          compare(16, 16, water, output)
          compare(10, 16, water, output)
          assert(
            waterMaterial.transparent && !waterMaterial.depthWrite && waterMaterial.colorWrite,
            'color material restored'
          )
        }
      }
      report.cases.push('above-inside-below-layer', 'low-medium-jitter', 'visible-water', 'seabed-below-datum')
      camera.clearViewOffset()
      camera.position.set(0, 0, radius + 20000 * unit)
      camera.updateMatrixWorld()
      peak.forEach((m) => (m.visible = true))
      compare(16, 16, peak, render())
      report.cases.push('terrain-peak-above-8km', 'dry-shore')
      peak.forEach((m) => (m.visible = false))
      const slope = new DataTexture(new Uint8Array([128, 128, 255, 0]), 1, 1)
      slope.needsUpdate = true
      owned.push(slope)
      waterMaterial.defines = { ...waterMaterial.defines, USE_WATER_DEPTH: 1 }
      waterMaterial.uniforms.uSlopeMap.value = slope
      const originalShader = waterMaterial.fragmentShader
      waterMaterial.fragmentShader = originalShader.replace(
        'gl_FragColor = vec4(color, alpha);',
        'gl_FragColor = vec4(alpha, fresnel, depthAlpha, 1.0);'
      )
      waterMaterial.transparent = false
      waterMaterial.needsUpdate = true
      renderer.setRenderTarget(readTarget)
      renderer.setScissorTest(false)
      renderer.clear()
      renderer.render(scene, camera)
      renderer.readRenderTargetPixels(readTarget, 0, 0, size, size, buffer)
      const shoreAlpha = buffer[(16 * size + 16) * 4]
      assert(buffer[(16 * size + 16) * 4 + 2] === 0, 'zero shore absorption alpha')
      assert(shoreAlpha > 0 && shoreAlpha < 1e-20, `measured tiny-positive final shore alpha: ${shoreAlpha}`)
      waterMaterial.fragmentShader = originalShader
      waterMaterial.transparent = true
      waterMaterial.needsUpdate = true
      compare(16, 16, shoreAlpha > 0 ? water : seabed, render())
      report.cases.push('zero-absorption-shore-final-alpha', 'tiny-positive-final-alpha-water')
      // Controlled branch fixture, not a claim that the natural shader reaches exact zero on every GPU.
      // Preserve the real vertex/shore/wave code and inject only its final alpha immediately before the terminal.
      const variant = waterMaterial.getSceneCloudDepthMaterial(slope, new Vector2(size, size))
      const variantShader = variant.fragmentShader
      variant.fragmentShader = variantShader.replace(
        'if (alpha <= 0.0) discard;',
        'alpha = 0.0;\n        if (alpha <= 0.0) discard;'
      )
      variant.needsUpdate = true
      compare(16, 16, seabed, render())
      seabed.forEach((m) => (m.visible = false))
      compare(16, 16, [], render())
      seabed.forEach((m) => (m.visible = true))
      variant.fragmentShader = variantShader
      variant.needsUpdate = true
      report.cases.push('zero-final-alpha-branch-fixture')
      ;(slope.image.data as Uint8Array)[3] = 255
      slope.needsUpdate = true
      compare(16, 16, water, render())
      report.cases.push('positive-coverage-shore')
      const normalMap = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)
      normalMap.needsUpdate = true
      owned.push(normalMap)
      waterMaterial.defines.USE_WATER_WAVES = 1
      waterMaterial.uniforms.uWaterNormalMap.value = normalMap
      waterMaterial.uniforms.uFoamStrength.value = 0.4
      waterMaterial.uniforms.uSlopeTexel.value.set(1, 1)
      waterMaterial.uniforms.uSlopeTexelMeters.value.set(1000, 1000)
      compare(16, 16, water, render())
      delete waterMaterial.defines.USE_WATER_WAVES
      report.cases.push('water-waves-foam-variant')
      foreground.visible = true
      compare(16, 16, [foreground], render())
      report.cases.push('foreground-opaque')
      const alphaMap = new DataTexture(new Uint8Array([255, 0, 255, 255]), 1, 1)
      alphaMap.minFilter = alphaMap.magFilter = NearestFilter
      alphaMap.needsUpdate = true
      owned.push(alphaMap)
      foregroundMaterial.alphaMap = alphaMap
      foregroundMaterial.alphaTest = 0.5
      foregroundMaterial.needsUpdate = true
      ;(alphaMap.image.data as Uint8Array)[1] = 255
      alphaMap.needsUpdate = true
      compare(16, 16, [foreground], render())
      report.cases.push('alpha-cut-solid')
      ;(alphaMap.image.data as Uint8Array)[1] = 0
      alphaMap.needsUpdate = true
      ;[...seabed, ...water].forEach((m) => (m.visible = false))
      const hole = render()
      compare(16, 16, [], hole)
      report.cases.push('alpha-cut-hole')
      foreground.visible = false
      planet.visible = true
      camera.position.set(0, 0, 3 * radius)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      const horizon = render()
      // Real sphere silhouette: discrepancies may extend at most one raster pixel.
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          rays.setFromCamera(new Vector2(((x + 0.5) / size) * 2 - 1, ((y + 0.5) / size) * 2 - 1), camera)
          const hit = rays.intersectObject(planet, false).length > 0
          const gpuHit = buffer[(y * size + x) * 4] < 1
          if (hit !== gpuHit) {
            let neighbour = false
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx,
                  yy = y + dy
                if (xx >= 0 && yy >= 0 && xx < size && yy < size && buffer[(yy * size + xx) * 4] < 1 === hit)
                  neighbour = true
              }
            assert(neighbour, `silhouette exceeds one pixel at ${x},${y}`)
          }
        }
      compare(16, 16, [planet], horizon)
      report.cases.push('planet-horizon')
      // A shader/geometry callback failure must restore every scoped renderer/material setting.
      const savedTarget = readTarget,
        vp = new Vector4(2, 3, 20, 21),
        sc = new Vector4(4, 5, 15, 16)
      renderer.setRenderTarget(savedTarget)
      renderer.setViewport(vp)
      renderer.setScissor(sc)
      renderer.setScissorTest(true)
      const bg = new Color(0.2, 0.3, 0.4)
      scene.background = bg
      const previous = planet.onBeforeRender
      planet.onBeforeRender = () => {
        throw Error('intentional depth failure')
      }
      let thrown = false
      try {
        depth.render(frame())
      } catch (e) {
        thrown = String(e).includes('intentional depth failure')
      }
      planet.onBeforeRender = previous
      assert(
        thrown &&
          scene.background === bg &&
          renderer.getRenderTarget() === savedTarget &&
          renderer.getViewport(new Vector4()).equals(vp) &&
          renderer.getScissor(new Vector4()).equals(sc) &&
          renderer.getScissorTest() &&
          planet.material.colorWrite,
        'failure restoration'
      )
      report.cases.push('failure-restoration', msaa ? 'msaa' : 'no-msaa')
    } finally {
      const texturesBeforeDepthDispose = renderer.info.memory.textures
      depth.dispose()
      assert(
        texturesBeforeDepthDispose - renderer.info.memory.textures === 7,
        'all seven service depth textures released'
      )
      readTarget.dispose()
      readMaterial.dispose()
      readQuad.geometry.dispose()
      owned.forEach((x) => x.dispose())
      renderer.setRenderTarget(null)
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }
  report.cases = [...new Set(report.cases)]
  report.resourcesReleased = true
  return report
}
