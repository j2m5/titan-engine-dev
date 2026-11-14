import {
  DataTexture, FloatType, Mesh, NearestFilter, OrthographicCamera, PlaneGeometry, RGBAFormat,
  Scene, ShaderMaterial, Uniform, Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { terrainDetailFunctions, terrainDetailUniforms } from '@/core/materials/shaders/lib/chunks/TerrainDetail'
import { triplanarDetailFunctions } from '@/core/materials/shaders/lib/chunks/TriplanarDetail'

/** Read the actual terrain-detail GLSL: material coverage must not layer the two normals. */
export function checkDetailMaterialBlend() {
  const renderer = new WebGLRenderer()
  renderer.setSize(1, 1)
  const target = new WebGLRenderTarget(1, 1, {
    type: FloatType, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false
  })
  const normalTexture = (x: number, y: number, z: number): DataTexture => {
    const texture = new DataTexture(
      new Float32Array([(x + 1) / 2, (y + 1) / 2, (z + 1) / 2, 1]), 1, 1, RGBAFormat, FloatType
    )
    texture.minFilter = texture.magFilter = NearestFilter
    texture.needsUpdate = true
    return texture
  }
  const native = normalTexture(0.8, 0, 0.6)
  const opposite = normalTexture(-0.8, 0, 0.6)
  const oblique = normalTexture(0, 0.6, 0.8)
  const gravelColor = normalTexture(-0.5, 0, 0.5)
  const uniforms = {
    uDetailNorMap: new Uniform(native), uSteepNorMap: new Uniform(native), uDetailNor2Map: new Uniform(native),
    uDetailArmMap: new Uniform(native), uSteepArmMap: new Uniform(native),
    uDetailDiffMap: new Uniform(native), uSteepDiffMap: new Uniform(native),
    uDetailLayerGates: new Uniform(new Vector3()),
    uDetailFadeRange: new Uniform(new Vector4(10, 20, 1, 2)),
    uDetailScale: new Uniform(1), uDetailScale2: new Uniform(1), uDetailNormalScale: new Uniform(1),
    uDetailTintNorm: new Uniform(new Vector2(1, 1)), uSteepTintNorm: new Uniform(new Vector2(1, 1)),
    uDetailSaturation: new Uniform(0), uDetailBrightness: new Uniform(1), uDetailAoInfluence: new Uniform(0),
    uSteepGate: new Uniform(0), uSteepMask: new Uniform(new Vector3(0, 1, 0)),
    uSteepTint: new Uniform(new Vector3(1, 1, 1)),
    uTalusDiffMap: new Uniform(gravelColor), uTalusGate: new Uniform(0), uTalusTintNorm: new Uniform(1), uProbeOutput: new Uniform(0),
    uProbeDistance: new Uniform(0), uProbeBase: new Uniform(new Vector3(0, 0, 1)), uProbeTalus: new Uniform(0)
  }
  const material = new ShaderMaterial({
    defines: { USE_TERRAIN_TALUS: 1 },
    uniforms,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `${terrainDetailUniforms}
      ${triplanarDetailFunctions}
      ${terrainDetailFunctions}
      uniform float uProbeDistance;
      uniform float uProbeTalus;
      uniform float uProbeOutput;
      uniform vec3 uProbeBase;
      void main() {
        vec3 normal = uProbeBase;
        vec3 albedo = vec3(1.0);
        float occlusion = 1.0, roughness = 1.0;
        // slopeTan = 1, no breakup: uSteepGate is the exact material coverage.
        applyTerrainDetail(normal, albedo, occlusion, vec3(1.0, 2.0, 3.0), vec3(1.0, 2.0, 3.0), uProbeDistance, 1.0, uProbeTalus, roughness);
        gl_FragColor = vec4(mix(normal, albedo, uProbeOutput), 1.0);
      }`
  })
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  scene.add(new Mesh(geometry, material))
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const results: { checks: number; maxError: number; cases: string[] } = { checks: 0, maxError: 0, cases: [] }
  const read = (coverage: number, talus = 0): number[] => {
    uniforms.uSteepGate.value = coverage
    uniforms.uProbeTalus.value = talus
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)
    const pixel = new Float32Array(4)
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel)
    const gl = renderer.getContext()
    const error = gl.getError()
    if (error !== gl.NO_ERROR) throw new Error(`Terrain detail WebGL error: ${error}`)
    return Array.from(pixel).slice(0, 3)
  }
  const check = (label: string, actual: number[], expected: number[]) => {
    const error = Math.max(...actual.map((value, i) => Math.abs(value - expected[i])))
    results.maxError = Math.max(results.maxError, error)
    results.checks++
    results.cases.push(label)
    if (!Number.isFinite(error) || error > 0.0001) {
      throw Object.assign(new Error(`${label}: expected ${expected}, got ${actual}`), { results })
    }
  }
  try {
    // Identical materials must retain their normal throughout the coverage transition.
    for (const coverage of [0, 0.0031, 0.25, 0.5, 0.75, 0.9969, 1]) {
      check(`identical maps at ${coverage}`, read(coverage), [0.8, 0, 0.6])
    }
    uniforms.uSteepNorMap.value = opposite
    check('equal opposing normals cancel', read(0.5), [0, 0, 1])

    // Relabeling the two materials and complementing their coverage cannot change lighting.
    for (const base of [new Vector3(0, 0, 1), new Vector3(0.3, -0.4, 0.8).normalize()]) {
      uniforms.uProbeBase.value.copy(base)
      for (const distance of [0, 15]) {
        uniforms.uProbeDistance.value = distance
        for (const coverage of [0.1, 0.25, 0.5, 0.75, 0.9]) {
          uniforms.uDetailNorMap.value = native
          uniforms.uSteepNorMap.value = oblique
          const original = read(coverage)
          uniforms.uDetailNorMap.value = oblique
          uniforms.uSteepNorMap.value = native
          check(`material order at ${coverage}, distance ${distance}, base ${base.toArray()}`, read(1 - coverage), original)
        }
      }
    }
    uniforms.uProbeDistance.value = 20
    check('detail fade restores base normal', read(0.5), uniforms.uProbeBase.value.toArray())
    uniforms.uProbeDistance.value = 0
    uniforms.uDetailNormalScale.value = 0
    check('zero detail strength restores base normal', read(0.5), uniforms.uProbeBase.value.toArray())
    uniforms.uProbeBase.value.set(0, 0, 1)
    uniforms.uDetailNormalScale.value = 1
    uniforms.uDetailNorMap.value = native
    uniforms.uSteepNorMap.value = opposite
    for (const talus of [0.25, 0.5, 0.75, 1]) {
      const dusty = new Vector3(0.8, 0, 0.6).lerp(uniforms.uProbeBase.value, 0.8 * talus).normalize()
      const expected = dusty.lerp(new Vector3(-0.8, 0, 0.6), 1 - talus).normalize()
      check(`talus covers the wall at ${talus}`, read(1, talus), expected.toArray())
    }
    uniforms.uProbeOutput.value = 1
    uniforms.uDetailLayerGates.value.z = 1
    uniforms.uTalusGate.value = 1
    const luminance = 0.25 * 0.2126 + 0.5 * 0.7152 + 0.75 * 0.0722
    for (const talus of [0, 0.5, 1])
      check(`gravel color coverage ${talus}`, read(1, talus), Array(3).fill(1 + talus * (luminance - 1)))
    uniforms.uTalusGate.value = 0
    check('missing gravel map stays neutral', read(1, 1), [1, 1, 1])
    uniforms.uTalusGate.value = 1
    uniforms.uProbeDistance.value = 2
    check('grain color fades with the grain normal', read(1, 1), [1, 1, 1])
    return results
  } finally {
    target.dispose()
    geometry.dispose()
    material.dispose()
    native.dispose()
    opposite.dispose()
    oblique.dispose()
    gravelColor.dispose()
    renderer.dispose()
    renderer.forceContextLoss()
  }
}
