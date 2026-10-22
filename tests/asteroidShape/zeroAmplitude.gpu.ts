import {
  BufferGeometry, Float32BufferAttribute, FloatType, NoBlending, OrthographicCamera,
  Points, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget
} from 'three'
import { asteroidShapeFunctions } from '@/core/materials/shaders/lib/chunks/AsteroidShape'
import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'
import { deformationReference } from './deformationReference'

/** Count observable derivative-noise calls in the real vertex chunk, and compare
 * position/normal output with the original formula. GPU timings live in benchmarks. */
export function checkAsteroidZeroAmplitude() {
  const width = 32, height = 16, count = width * height
  const amplitudes = [0, -0, 1e-8, -1e-8, 0.04, -0.04, 0.25, -0.25]
  const radii = [0, 1e-9, 1e-6, 0.15, 1, 4, 1000]
  const positions: number[] = [], normals: number[] = [], seeds: number[] = [], amps: number[] = [], pixels: number[] = []
  let seed = 7654321
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < count; i++) {
    const radius = radii[Math.floor(i / amplitudes.length) % radii.length]
    positions.push((random() * 2 - 1) * radius, (random() * 2 - 1) * radius, (random() * 2 - 1) * radius)
    const normal = new Vector3(random() + 0.1, random() - 0.5, random() - 0.5).normalize().multiplyScalar(i % 3 ? 1 : 1.7)
    normals.push(...normal.toArray()); seeds.push(random()); amps.push(amplitudes[i % amplitudes.length])
    pixels.push((i % width + 0.5) / width * 2 - 1, (Math.floor(i / width) + 0.5) / height * 2 - 1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1))
  geometry.setAttribute('aAmplitude', new Float32BufferAttribute(amps, 1))
  geometry.setAttribute('aPixel', new Float32BufferAttribute(pixels, 2))
  const noiseEntry = 'vec4 snoiseGrad(vec3 v) {'
  if (!noiseFunctions.includes(noiseEntry)) throw new Error('Derivative noise instrumentation entry missing')
  const material = new ShaderMaterial({
    uniforms: { uShapeFreq: { value: 1 }, uOutput: { value: 0 } },
    vertexShader: `
      uniform float uShapeFreq;
      attribute float aSeed, aAmplitude;
      attribute vec2 aPixel;
      varying vec3 vPosition, vNormal, vReferencePosition, vReferenceNormal;
      varying float vNoiseCalls;
      float diagnosticNoiseCalls;
      ${noiseFunctions.replace(noiseEntry, noiseEntry + '\n diagnosticNoiseCalls += 1.0;')}
      ${asteroidShapeFunctions}
      ${deformationReference}
      void main() {
        diagnosticNoiseCalls = 0.0;
        deformAsteroid(position, normal, aSeed, aAmplitude, vPosition, vNormal);
        vNoiseCalls = diagnosticNoiseCalls;
        referenceDeform(position, normal, aSeed, aAmplitude, vReferencePosition, vReferenceNormal);
        gl_Position = vec4(aPixel, 0.0, 1.0); gl_PointSize = 1.0;
      }`,
    fragmentShader: `
      uniform int uOutput;
      varying vec3 vPosition, vNormal, vReferencePosition, vReferenceNormal;
      varying float vNoiseCalls;
      void main() {
        if (uOutput == 0) gl_FragColor = vec4(vPosition, vNoiseCalls);
        else if (uOutput == 1) gl_FragColor = vec4(vReferencePosition, 1.0);
        else if (uOutput == 2) gl_FragColor = vec4(vNormal, 1.0);
        else gl_FragColor = vec4(vReferenceNormal, 1.0);
      }`,
    depthWrite: false, depthTest: false, blending: NoBlending
  })
  const renderer = new WebGLRenderer(), target = new WebGLRenderTarget(width, height, { type: FloatType, depthBuffer: false })
  renderer.setSize(width, height)
  const points = new Points(geometry, material), camera = new OrthographicCamera()
  points.frustumCulled = false
  const results = []
  try {
    for (const frequency of [0, 1, 7.3]) {
      material.uniforms.uShapeFreq.value = frequency
      const outputs = []
      for (let mode = 0; mode < 4; mode++) {
        material.uniforms.uOutput.value = mode
        renderer.setRenderTarget(target); renderer.render(points, camera)
        const data = new Float32Array(count * 4)
        renderer.readRenderTargetPixels(target, 0, 0, width, height, data)
        outputs.push(data)
      }
      let skipped = 0, evaluated = 0, maxPositionError = 0, maxNormalError = 0
      for (let i = 0; i < count; i++) {
        const expectedCalls = amps[i] === 0 ? 0 : 2, calls = outputs[0][i * 4 + 3]
        if (calls !== expectedCalls) throw new Error(`amp=${amps[i]}, frequency=${frequency}: expected ${expectedCalls} derivative-noise calls, got ${calls}`)
        if (calls === 0) skipped++; else evaluated++
        // With zero amplitude, dir * R still differs from raw position below
        // the radius clamp. Scale the tolerance to the reference vector so
        // that tiny radii cannot hide an incorrect early return of position.
        const referenceScale = Math.max(...outputs[1].subarray(i * 4, i * 4 + 3).map(Math.abs))
        for (let c = 0; c < 3; c++) {
          const offset = i * 4 + c, reference = outputs[1][offset]
          const positionError = Math.abs(outputs[0][offset] - reference), normalError = Math.abs(outputs[2][offset] - outputs[3][offset])
          const positionTolerance = 1e-6 * (amps[i] === 0 ? referenceScale : Math.max(1, Math.abs(reference)))
          if (!Number.isFinite(positionError) || !Number.isFinite(normalError) || positionError > positionTolerance || normalError > 1e-6) {
            throw new Error(`Deformation mismatch at ${i}, amp=${amps[i]}, frequency=${frequency}: position=${positionError} (tolerance=${positionTolerance}), normal=${normalError}`)
          }
          maxPositionError = Math.max(maxPositionError, positionError); maxNormalError = Math.max(maxNormalError, normalError)
        }
      }
      if (!skipped || !evaluated || renderer.getContext().getError()) throw new Error('Deformation probe missing coverage or WebGL error')
      results.push({ frequency, skipped, evaluated, maxPositionError, maxNormalError })
    }
    return { vertices: count, amplitudes, radii, results }
  } finally {
    renderer.setRenderTarget(null)
    geometry.dispose(); material.dispose(); target.dispose(); renderer.dispose(); renderer.forceContextLoss()
  }
}
