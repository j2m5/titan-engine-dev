/**
 * CPU-зеркало композиции цвета WaterShaderTemplate.ts (main(), фрагментник) —
 * тот же класс стража, что waterWaveNormalMirror.ts, но для приёмочного
 * фикса «молочный океан + яркое пятно + голубое гало из космоса»: КОРЕНЬ был
 * в том, что waves-формула цвета применялась БЕЗУСЛОВНО, не смешивалась с
 * фундаментом по fade. Порт двух формул — foundationColor (безусловная
 * часть main(), не зависит от USE_WATER_WAVES) и wavesColor (полная формула
 * Water.js, включая СОБСТВЕННЫЙ ночной пол) — плюс их смешивание по
 * waveFade, буквально повторяющее `color = mix(color, wavesColor, waveFade)`
 * в шейдере.
 *
 * ВАЖНО: менять строго синхронно с main() в
 * src/core/materials/shaders/lib/WaterShaderTemplate.ts.
 */

export type Vec3 = readonly [number, number, number]

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function mulVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

function mixScalar(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t
}

function mix3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [mixScalar(a[0], b[0], t), mixScalar(a[1], b[1], t), mixScalar(a[2], b[2], t)]
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0))

  return t * t * (3 - 2 * t)
}

function normalize3(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])

  return len < 1e-9 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len]
}

/** GLSL reflect(I, N) = I - 2*dot(N,I)*N */
function reflectVec(i: Vec3, n: Vec3): Vec3 {
  return sub3(i, scale3(n, 2 * dot3(n, i)))
}

/**
 * Фундаментная формула (Task 4) — безусловная часть main(), НЕ зависит от
 * USE_WATER_WAVES: fresnel-mix + собственный ночной пол. Именно то, что
 * компилируется и рендерится, когда USE_WATER_WAVES не определён (см.
 * паритетный тест в WaterWaves.spec.ts) — и то, к чему обязан численно
 * свестись блендинг при waveFade=0.
 */
export function foundationColor(
  baseColor: Vec3,
  fresnelTint: Vec3,
  normal: Vec3,
  viewDir: Vec3,
  lightDir: Vec3,
  nightFloor: number
): Vec3 {
  const fresnel = Math.pow(clamp01(1 - Math.max(dot3(viewDir, normal), 0)), 5)
  const color = mix3(baseColor, fresnelTint, fresnel)
  const ndotl = dot3(normal, lightDir)
  const dayFactor = smoothstep(-0.08, 0.25, ndotl)

  return scale3(color, mixScalar(nightFloor, 1, dayFactor))
}

/** sunLight — дословно Water.js: reflection = reflect(-lightDir, normal), coefficients через аргументы. */
function sunLight(
  surfaceNormal: Vec3,
  eyeDirection: Vec3,
  shiny: number,
  spec: number,
  diffuse: number,
  sunColor: Vec3,
  lightDir: Vec3
): { diffuseColor: Vec3; specularColor: Vec3 } {
  const reflection = normalize3(reflectVec(scale3(lightDir, -1), surfaceNormal))
  const direction = Math.max(0, dot3(eyeDirection, reflection))
  const specularColor = scale3(sunColor, Math.pow(direction, shiny) * spec)
  const diffuseColor = scale3(sunColor, Math.max(dot3(lightDir, surfaceNormal), 0) * diffuse)

  return { diffuseColor, specularColor }
}

/**
 * Полная waves-формула Water.js (albedo mix, rf0=0.3, getShadowMask опущен)
 * ПЛЮС собственный ночной пол (waveNdotL/waveDayFactor, НЕ фундаментный
 * dayFactor) — то, во что main() кладёт wavesColor непосредственно перед
 * финальным `color = mix(color, wavesColor, waveFade)`.
 */
export function wavesColor(
  baseColor: Vec3,
  reflectionSample: Vec3,
  waveNormal: Vec3,
  viewDir: Vec3,
  lightDir: Vec3,
  sunColor: Vec3,
  nightFloor: number
): Vec3 {
  const { diffuseColor, specularColor } = sunLight(waveNormal, viewDir, 100, 2, 0.5, sunColor, lightDir)
  const theta = Math.max(dot3(viewDir, waveNormal), 0)
  const rf0 = 0.3
  const reflectance = rf0 + (1 - rf0) * Math.pow(1 - theta, 5)
  const scatter = scale3(baseColor, Math.max(0, dot3(waveNormal, viewDir)))

  const term1 = add3(scale3(mulVec3(sunColor, diffuseColor), 0.3), scatter)
  const term2 = add3(add3([0.1, 0.1, 0.1], scale3(reflectionSample, 0.9)), mulVec3(reflectionSample, specularColor))
  const raw = mix3(term1, term2, reflectance)

  const waveNdotL = dot3(waveNormal, lightDir)
  const waveDayFactor = smoothstep(-0.08, 0.25, waveNdotL)

  return scale3(raw, mixScalar(nightFloor, 1, waveDayFactor))
}

export interface BlendInputs {
  baseColor: Vec3
  fresnelTint: Vec3
  reflectionSample: Vec3
  normal: Vec3
  waveNormal: Vec3
  viewDir: Vec3
  lightDir: Vec3
  sunColor: Vec3
  nightFloor: number
}

/** color = mix(foundationColor(...), wavesColor(...), waveFade) — буквально итоговая строка main(). */
export function blendedColor(inputs: BlendInputs, waveFade: number): Vec3 {
  const foundation = foundationColor(
    inputs.baseColor,
    inputs.fresnelTint,
    inputs.normal,
    inputs.viewDir,
    inputs.lightDir,
    inputs.nightFloor
  )
  const waves = wavesColor(
    inputs.baseColor,
    inputs.reflectionSample,
    inputs.waveNormal,
    inputs.viewDir,
    inputs.lightDir,
    inputs.sunColor,
    inputs.nightFloor
  )

  return mix3(foundation, waves, waveFade)
}

export function dirFromLatLon(latDeg: number, lonDeg: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180

  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]
}
