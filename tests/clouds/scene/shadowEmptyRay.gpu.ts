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
uniform float fixtureExtinction, fixtureDistance;
const int maxIterationCount = 2;
const float minStepSize = 1.0, maxStepSize = 1.0, minExtinction = 1e-7, minDensity = 0.0;
const float minTransmittance = 0.0, opticalDepthTailScale = 1.0, bottomRadius = 1.0;
struct WeatherSample { vec4 density; };
struct MediaSample { float extinction; };
vec3 getStructureNormal(vec3 direction, float jitter) { return direction; }
void intersectStructuredPlanes(vec3 normal, vec3 origin, vec3 direction, float size,
  out float distance, out float stepSize) { distance = 1.0; stepSize = size; }
bool insideLayerIntervals(float height) { return false; }
vec2 getGlobeUv(vec3 position) { return vec2(0.0); }
WeatherSample sampleWeather(vec2 uv, float height, float mip) { return WeatherSample(vec4(1.0)); }
MediaSample sampleMedia(WeatherSample weather, vec3 position, vec2 uv, float mip, float jitter) {
  return MediaSample(fixtureExtinction);
}
${source.slice(start, end)}
void main() { gl_FragColor = marchClouds(vec3(0.0), vec3(0.0,0.0,1.0), fixtureDistance, 0.0, 0.0); }
`
  const marchUniforms = { fixtureExtinction: { value: 0 }, fixtureDistance: { value: 1e6 } }
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
  for (const empty of [false, true]) {
    const color = empty ? [65504, 0, 0, 0] : [123, 2e-7, 0.25, 0.5]
    uniforms.fixtureColor.value.fromArray(color)
    for (const uv of [
      [0.5, 0.5],
      [0, 1],
      [0.25, 0.75],
      [-1e6, 1e6],
      [1e30, -1e30]
    ]) {
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
const int inputBuffer = 0;
vec4 fixtureFetch(int sampler, ivec3 coord, int lod, ivec2 offset) {
  return fixtureNeighbors[(offset.x + 1) * 3 + offset.y + 1];
}
#define texelFetchOffset fixtureFetch
${resolveSource.slice(closestStart, closestEnd)}
void main() { gl_FragColor = getClosestFragment(ivec3(1,1,0)); }
`
  const neighbors = Array.from({ length: 9 }, () => new Vector4(-1, 0, 0, 0))
  for (const [depth, expected] of [
    [-1, [1e7, 0, 0, 0]],
    [100, [100, 0.25, -0.5, 0]],
    [0, [0, 0.25, -0.5, 0]]
  ] as const) {
    neighbors[4].set(depth, depth < 0 ? 0 : 0.25, depth < 0 ? 0 : -0.5, 0)
    const actual = draw(closest, { fixtureNeighbors: { value: neighbors } })
    check(
      actual.every((value, i) => value === expected[i]),
      `empty neighbors do not steal occupied history depth=${depth}: ${actual}`
    )
  }
}
