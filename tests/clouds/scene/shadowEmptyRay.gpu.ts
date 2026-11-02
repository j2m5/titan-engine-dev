import { Vector2, Vector4, type ShaderMaterial } from 'three'

/** Exercise the production march and export separately with controlled density
 * and reprojection. The real lighting probe joins them with actual textures. */
export function checkSceneCloudShadowEmptyRay(
  source: string,
  resolveSource: string,
  draw: (fragment: string, uniforms: ShaderMaterial['uniforms']) => number[],
  check: (condition: boolean, label: string) => void
): void {
  const start = source.indexOf('vec4 marchClouds('),
    end = source.indexOf('void getRayNearFar(', start),
    exportStart = source.indexOf('  outputColor = color;', end),
    exportEnd = source.indexOf('  #endif // TEMPORAL_PASS', exportStart)
  if (start < 0 || end <= start || exportStart < end || exportEnd < exportStart)
    throw new Error('Missing production shadow march/export for empty-ray regression')
  const march = `
#define TEMPORAL_JITTER
uniform float fixtureExtinction, fixtureDistance;
uniform float fixtureJitter, fixtureOffset, minStepSize, maxStepSize, minTransmittance;
const int maxIterationCount = 2;
const float minExtinction = 1e-7, minDensity = 0.0;
const float opticalDepthTailScale = 1.0, bottomRadius = 1.0;
struct WeatherSample { vec4 density; };
struct MediaSample { float extinction; };
vec3 getStructureNormal(vec3 direction, float jitter) { return direction; }
void intersectStructuredPlanes(vec3 normal, vec3 origin, vec3 direction, float size,
  out float distance, out float stepSize) { distance = fixtureOffset; stepSize = size; }
bool insideLayerIntervals(float height) { return false; }
vec2 getGlobeUv(vec3 position) { return vec2(0.0); }
WeatherSample sampleWeather(vec2 uv, float height, float mip) { return WeatherSample(vec4(1.0)); }
MediaSample sampleMedia(WeatherSample weather, vec3 position, vec2 uv, float mip, float jitter) {
  return MediaSample(fixtureExtinction);
}
${source.slice(start, end)}
void main() { gl_FragColor = marchClouds(vec3(0.0), vec3(0.0,0.0,1.0), fixtureDistance, fixtureJitter, 0.0); }
`
  const marchUniforms = {
    fixtureExtinction: { value: 0 },
    fixtureDistance: { value: 1e6 },
    fixtureJitter: { value: 0 },
    fixtureOffset: { value: 1 },
    minStepSize: { value: 1 },
    maxStepSize: { value: 1 },
    minTransmittance: { value: 0 }
  }
  for (const [distance, emptyDepth] of [
    [100, 100],
    [1e6, 65504],
    [1e30, 65504]
  ]) {
    marchUniforms.fixtureDistance.value = distance
    for (const extinction of [0, 1e-8, 1e-7, 2e-7, 0.25]) {
      marchUniforms.fixtureExtinction.value = extinction
      const actual = draw(march, marchUniforms),
        empty = extinction <= 1e-7
      check(actual.every(Number.isFinite), `shadow march finite distance=${distance}, extinction=${extinction}`)
      check(
        empty
          ? actual[0] === emptyDepth && actual.slice(1).every((value) => value === 0)
          : actual[0] > 0 && actual[1] > 0 && actual[2] > 0,
        `shadow march ${empty ? 'neutral empty' : 'occupied'} distance=${distance}, extinction=${extinction}: ${actual}`
      )
      if (empty) {
        // A cloud at either sampled distance (1 or 2 metres) must not move
        // toward the light when linearly filtered with an empty neighbor.
        const mixedFront = (actual[0] + 2) * 0.5
        check(mixedFront >= 2, `empty neighbor does not move shadow front toward light: ${mixedFront}`)
      }
    }
  }

  // A ray starting inside cloud can contribute before its origin after jitter.
  // Use real march results in the export checks, including the empty marker -1.
  const negativeOccupied: number[][] = []
  marchUniforms.fixtureDistance.value = 1e6
  marchUniforms.fixtureExtinction.value = 0.25
  marchUniforms.minTransmittance.value = 0.9
  for (const [step, offset, jitter, depth] of [
    [1, 0.25, 0.75, -0.5],
    [10, 0, 0.1, -1]
  ]) {
    marchUniforms.minStepSize.value = marchUniforms.maxStepSize.value = step
    marchUniforms.fixtureOffset.value = offset
    marchUniforms.fixtureJitter.value = jitter
    const actual = draw(march, marchUniforms)
    check(
      actual.every(Number.isFinite) && actual[0] === depth && actual[1] > 0,
      `jittered occupied shadow has signed depth ${depth}: ${actual}`
    )
    negativeOccupied.push(actual)
  }

  const fragment = `
#define TEMPORAL_PASS
uniform vec4 fixtureColor;
uniform vec2 fixturePreviousUv, resolution;
uniform bool fixtureVelocity;
void exportShadow(out vec4 outputColor, out vec3 outputDepthVelocity) {
  vec4 color = fixtureColor;
  vec3 rayOrigin = vec3(0.0), rayDirection = vec3(0.0,0.0,1.0), altitudeCorrection = vec3(0.0);
  mat4 ecefToWorldMatrix = mat4(1.0);
  mat4 reprojectionMatrices[1];
  reprojectionMatrices[0] = mat4(0.0);
  reprojectionMatrices[0][3] = vec4(fixturePreviousUv * 2.0 - 1.0, 0.0, 1.0);
  int cascadeIndex = 0;
  vec2 vUv = vec2(0.5);
${source.slice(exportStart, exportEnd + '  #endif // TEMPORAL_PASS'.length)}
}
void main() { vec4 color; vec3 velocity; exportShadow(color, velocity);
  gl_FragColor = fixtureVelocity ? vec4(velocity, 1.0) : color; }
`
  const uniforms = {
    fixtureColor: { value: new Vector4() },
    fixturePreviousUv: { value: new Vector2() },
    resolution: { value: new Vector2(7, 5) },
    fixtureVelocity: { value: false }
  }
  for (const color of [[123, 2e-7, 0.25, 0.5], [65504, 0, 0, 0], ...negativeOccupied]) {
    const empty = color[1] === 0
    uniforms.fixtureColor.value.fromArray(color)
    const positions =
      color[0] < 0
        ? [[0.25, 0.75]]
        : [
            [0.5, 0.5],
            [0, 1],
            [0.25, 0.75],
            [-1e6, 1e6],
            [1e30, -1e30]
          ]
    for (const uv of positions) {
      uniforms.fixturePreviousUv.value.fromArray(uv)
      uniforms.fixtureVelocity.value = false
      const actualColor = draw(fragment, uniforms)
      check(
        actualColor.every((value, i) => value === Math.fround(color[i])),
        `shadow optical data unchanged empty=${empty}, uv=${uv}`
      )
      uniforms.fixtureVelocity.value = true
      const velocity = draw(fragment, uniforms).slice(0, 3)
      check(velocity.every(Number.isFinite), `shadow motion finite empty=${empty}, uv=${uv}`)
      if (empty)
        check(
          velocity[0] === -1 && velocity[1] === 0 && velocity[2] === 0,
          `empty shadow has absent depth and neutral motion uv=${uv}`
        )
      else {
        check(velocity[0] === color[0], `occupied shadow depth unchanged uv=${uv}`)
        const previous = velocity.slice(1).map((value, axis) => 0.5 - value / [7, 5][axis])
        if (uv.every((value) => value >= 0 && value <= 1))
          check(
            previous.every((value, axis) => value === uv[axis]),
            `valid shadow history UV unchanged ${uv}`
          )
        else {
          check(
            velocity.slice(1).every((value, axis) => Math.abs(value) <= [7, 5][axis]),
            `offscreen motion fits half range ${uv}`
          )
          check(
            previous.some((value) => value < 0 || value > 1),
            `offscreen shadow history remains rejected ${uv}`
          )
        }
      }
    }
  }

  const closestStart = resolveSource.indexOf('const ivec2 neighborOffsets[9]'),
    closestEnd = resolveSource.indexOf('void cascade(', closestStart)
  if (closestStart < 0 || closestEnd < closestStart)
    throw new Error('Missing production shadow closest-fragment selection')
  const closest = `
#define CASCADE_COUNT 1
uniform vec4 fixtureNeighbors[9];
uniform float fixtureExtinctions[9];
const int inputBuffer = 0;
vec4 fixtureFetch(int sampler, ivec3 coord, int lod, ivec2 offset) {
  int index = (offset.x + 1) * 3 + offset.y + 1;
  return coord.z == 0 ? vec4(0.0, fixtureExtinctions[index], 0.0, 0.0) : fixtureNeighbors[index];
}
#define texelFetchOffset fixtureFetch
${resolveSource.slice(closestStart, closestEnd)}
void main() { gl_FragColor = getClosestFragment(ivec3(1,1,0)); }
`
  const neighbors = Array.from({ length: 9 }, () => new Vector4(-1, 0, 0, 0))
  const extinctions = new Float32Array(9)
  const closestUniforms = { fixtureNeighbors: { value: neighbors }, fixtureExtinctions: { value: extinctions } }
  for (const [depth, expected] of [
    [-1, [1e7, 0, 0, 0]],
    [100, [100, 0.25, -0.5, 0]],
    [0, [0, 0.25, -0.5, 0]],
    [-0.5, [-0.5, 0.25, -0.5, 0]],
    [-1, [-1, 0.25, -0.5, 0]],
    [-2, [-2, 0.25, -0.5, 0]]
  ] as const) {
    neighbors[4].set(depth, expected[1], expected[2], 0)
    extinctions[4] = expected[0] === 1e7 ? 0 : 0.25
    const actual = draw(closest, closestUniforms)
    check(
      actual.every((value, i) => value === expected[i]),
      `empty neighbors do not steal occupied history depth=${depth}: ${actual}`
    )
  }
  neighbors.forEach((value, index) => value.set(-index - 0.25, (index + 1) * 0.25, -(index + 1) * 0.5, 0))
  extinctions.fill(0.25)
  let actual = draw(closest, closestUniforms)
  check(
    actual.every((value, i) => value === neighbors[8].toArray()[i]),
    `all-negative occupied neighborhood retains nearest motion: ${actual}`
  )
  neighbors.forEach((value) => value.set(-1, 0, 0, 0))
  extinctions.fill(0)
  neighbors[2].set(-0.5, 0.75, -0.25, 0)
  neighbors[4].set(100, 0.25, -0.5, 0)
  extinctions[2] = extinctions[4] = 0.25
  actual = draw(closest, closestUniforms)
  check(
    actual.every((value, i) => value === neighbors[2].toArray()[i]),
    `mixed signed neighborhood retains nearest occupied motion: ${actual}`
  )
}
