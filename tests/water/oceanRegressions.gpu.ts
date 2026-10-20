import { type PerspectiveCamera, type ShaderMaterial, Vector3 } from 'three'

interface OceanRegressionContext {
  material: ShaderMaterial
  camera: PerspectiveCamera
  height: number
  read: () => Float32Array
  setView: (altitude: number, lookDistance: number) => void
}

const average = (pixels: Float32Array): number => {
  let sum = 0
  for (let i = 0; i < pixels.length; i += 4) sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
  return sum / (pixels.length / 4)
}

function replace(source: string, anchor: string, replacement: string): string {
  if (!source.includes(anchor)) throw new Error(`Missing GPU instrumentation anchor: ${anchor}`)
  return source.replace(anchor, replacement)
}

/** Instruments actual production output; no duplicate surface/lighting implementation. */
export function checkOceanRegressions({ material, camera, height, read, setView }: OceanRegressionContext) {
  const failures: string[] = []
  const check = (condition: boolean, message: string): void => { if (!condition) failures.push(message) }
  const uniforms = material.uniforms
  const original = material.fragmentShader
  const fov = camera.fov
  const pixelAngle = uniforms.uWaterPixelAngle.value
  const foam = uniforms.uFoamStrength.value
  const exposure = uniforms.uWaterSkyExposure.value
  const knee = uniforms.uWaterSkyHdrKnee.value
  const nightFloor = uniforms.uWaterNightFloor.value
  const defines = { ...material.defines }
  const setShader = (source: string): void => {
    material.fragmentShader = source
    material.needsUpdate = true
  }
  let grazingHeight = 0, grazingPixels = 0
  let eclipseSky = 0, partialError = 0, hdrPixels = 0, fallbackError = 0
  try {
    uniforms.uFoamStrength.value = 0
    camera.fov = 2 * Math.atan(Math.tan(25 * Math.PI / 180) * height / 1080) * 180 / Math.PI
    camera.updateProjectionMatrix()
    uniforms.uWaterPixelAngle.value = 2 * Math.tan(camera.fov * Math.PI / 360) / height
    setView(10, 1000)
    let instrumented = replace(original, 'void main() {', 'void main() {\n float auditHeight = 0.0;')
    instrumented = replace(instrumented, 'float oceanAlpha2 =', 'auditHeight = ocean.height;\n float oceanAlpha2 =')
    instrumented = replace(instrumented, 'gl_FragColor = vec4(color, alpha);',
      'gl_FragColor = vec4(abs(auditHeight), length(vViewPosition) * WATER_METERS_PER_UNIT, 0.0, alpha);')
    setShader(instrumented)
    const field = read()
    for (let i = 0; i < field.length; i += 4) {
      if (field[i + 3] === 0 || field[i + 1] < 900 || field[i + 1] > 1100) continue
      grazingHeight = Math.max(grazingHeight, field[i])
      grazingPixels++
    }
    check(grazingPixels > 100, `Grazing fixture has too few pixels: ${grazingPixels}`)
    check(grazingHeight < 0.01, `Unresolved grazing waves survive: ${grazingHeight} m`)

    camera.fov = fov
    camera.updateProjectionMatrix()
    uniforms.uWaterPixelAngle.value = pixelAngle
    setView(2, 100)
    const sun = new Vector3(0.25, 0.45, -1).normalize()
    uniforms.uEclipseStar.value.copy(sun).multiplyScalar(10000)
    uniforms.uEclipseStarRadius.value = 100
    uniforms.uEclipseOccluders.value[0].set(sun.x * 10, sun.y * 10, sun.z * 10, 4)
    uniforms.uEclipseUmbra.value[0].set(0, 0, 0, 0)
    uniforms.uEclipseCount.value = 1
    setShader(replace(original, 'gl_FragColor = vec4(color, alpha);', 'gl_FragColor = vec4(eclipse, alpha);'))
    const mask = read()
    check(average(mask) === 0, 'Eclipse fixture does not fully cover the water')

    let skyOutput = replace(original, 'void main() {', 'void main() {\n vec3 auditSky = vec3(0.0);')
    skyOutput = replace(skyOutput, 'float oceanDiffuse =', 'auditSky = oceanSky;\n float oceanDiffuse =')
    skyOutput = replace(skyOutput, 'gl_FragColor = vec4(color, alpha);', 'gl_FragColor = vec4(auditSky, alpha);')
    setShader(skyOutput)
    eclipseSky = average(read())
    check(eclipseSky < 1e-7, `Reflected sky ignores full eclipse: ${eclipseSky}`)

    // Attenuation must precede the atmosphere's nonlinear HDR knee.
    uniforms.uWaterSkyExposure.value = 100
    uniforms.uWaterSkyHdrKnee.value = 0.25
    uniforms.uEclipseCount.value = 0
    const clearSky = read()
    uniforms.uEclipseCount.value = 1
    const illumination = [0.5, 0.25, 0.75] as const
    uniforms.uEclipseUmbra.value[0].set(...illumination, 1)
    const partialSky = read()
    for (let i = 0; i < clearSky.length; i += 4) for (let c = 0; c < 3; c++) {
      const clear = clearSky[i + c]
      if (clear >= 63 || clear <= 1) continue
      const linear = 1 + (clear - 1) / 0.25
      const attenuated = linear * illumination[c]
      const expected = Math.min(attenuated, 1) + Math.max(attenuated - 1, 0) * 0.25
      partialError = Math.max(partialError, Math.abs(partialSky[i + c] - expected))
      hdrPixels++
    }
    check(hdrPixels > 100, `Partial-eclipse fixture lacks HDR samples: ${hdrPixels}`)
    check(partialError < 1e-4, `Eclipse applied after HDR compression: ${partialError}`)

    uniforms.uEclipseUmbra.value[0].set(0, 0, 0, 0)
    let ambientOutput = replace(original, 'void main() {', 'void main() {\n vec3 auditAmbient = vec3(0.0);')
    ambientOutput = replace(ambientOutput, 'float oceanDiffuse =', 'auditAmbient = oceanAmbient;\n float oceanDiffuse =')
    ambientOutput = replace(ambientOutput, 'gl_FragColor = vec4(color, alpha);',
      'gl_FragColor = vec4(auditAmbient, alpha);')
    for (const useAtmosphere of [true, false]) {
      material.defines = { ...defines }
      if (!useAtmosphere) {
        delete material.defines.USE_WATER_SKY
        delete material.defines.USE_SUN_TINT
        delete material.defines.USE_SKY_AMBIENT
        setShader(skyOutput)
        uniforms.uEclipseCount.value = 0
        const clearFallback = read()
        uniforms.uEclipseCount.value = 1
        const darkFallback = read()
        let fallbackPixels = 0
        for (let i = 0; i < clearFallback.length; i += 4) {
          if (clearFallback[i] === 0 && clearFallback[i + 1] === 0 && clearFallback[i + 2] === 0) continue
          // The sun is above the daytime ramp and the fallback tint is white.
          // Totality must retain exactly the night fraction of this environment.
          for (let c = 0; c < 3; c++) fallbackError = Math.max(fallbackError,
            Math.abs(darkFallback[i + c] - clearFallback[i + c] * nightFloor))
          fallbackPixels++
        }
        check(fallbackPixels > 100 && fallbackError < 1e-6,
          `Fallback reflection ignores eclipse or loses night floor: ${fallbackError}`)
      }
      setShader(ambientOutput)
      const ambient = read()
      let ambientError = 0, ambientPixels = 0
      for (let i = 0; i < ambient.length; i += 4) {
        if (ambient[i] === 0 && ambient[i + 1] === 0 && ambient[i + 2] === 0) continue
        for (let c = 0; c < 3; c++) ambientError = Math.max(ambientError, Math.abs(ambient[i + c] - nightFloor))
        ambientPixels++
      }
      check(ambientPixels > 100 && ambientError < 1e-6,
        `Solar ambient survives eclipse (${useAtmosphere}): ${ambientError}`)
    }
  } finally {
    setShader(original)
    material.defines = defines
    camera.fov = fov
    camera.updateProjectionMatrix()
    setView(12, 100)
    uniforms.uWaterPixelAngle.value = pixelAngle
    uniforms.uFoamStrength.value = foam
    uniforms.uWaterSkyExposure.value = exposure
    uniforms.uWaterSkyHdrKnee.value = knee
    uniforms.uEclipseCount.value = 0
    uniforms.uEclipseUmbra.value[0].set(0, 0, 0, 0)
  }
  if (failures.length) throw new Error(failures.join('\n'))
  return { grazingHeight, grazingPixels, eclipseSky, partialError, hdrPixels, fallbackError }
}
