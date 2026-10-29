import { Vector4, type ShaderMaterial } from 'three'

/** Run the installed detail branch with a counted normalized texture lookup.
 * Empty coarse density stays empty; any contributing channel retains erosion. */
export function checkSceneCloudEmptyDensityDetail(
  source: string,
  draw: (fragment: string, uniforms: ShaderMaterial['uniforms']) => number[],
  check: (condition: boolean, label: string) => void
): void {
  const start = source.indexOf('  #ifdef SHAPE_DETAIL', source.indexOf('MediaSample sampleMedia(')),
    endMarker = '  #endif // SHAPE_DETAIL',
    end = source.indexOf(endMarker, start)
  if (start < 0 || end < start) throw new Error('Missing production density detail branch')
  const fragment = `
#define SHAPE_DETAIL
#define DEBUG_SHOW_SAMPLE_COUNT
uniform vec4 fixtureDensity, fixtureHeight, shapeDetailAmounts;
uniform float fixtureDetail, mipLevel, jitter;
uniform bool fixtureCount;
int fixtureLookups = 0;
int fixtureImplicitLookups = 0;
vec4 fixtureTextureLod(int sampler, vec3 position, float lod) {
  ++fixtureLookups;
  return vec4(fixtureDetail);
}
vec4 fixtureTexture(int sampler, vec3 position) {
  ++fixtureImplicitLookups;
  return fixtureTextureLod(sampler, position, 0.0);
}
#define textureLod fixtureTextureLod
#define texture fixtureTexture
#define shapeDetailTexture 0
struct WeatherSample { vec4 heightFraction; };
vec4 remapClamped(vec4 value, vec4 low, vec4 high) {
  return clamp((value - low) / (high - low), 0.0, 1.0);
}
void main() {
  vec4 density = fixtureDensity;
  WeatherSample weather;
  weather.heightFraction = fixtureHeight;
  vec3 position = vec3(0.0), turbulence = vec3(0.0);
  vec3 shapeDetailRepeat = vec3(1.0), shapeDetailOffset = vec3(0.0);
  mat3 cloudECEFToPlanet = mat3(1.0);
  ivec3 sampleCount = ivec3(0);
${source.slice(start, end + endMarker.length)}
  gl_FragColor = fixtureCount ? vec4(float(fixtureLookups), float(sampleCount.z), float(fixtureImplicitLookups), 1.0) : density;
}
`
  const uniforms = {
    fixtureDensity: { value: new Vector4(0, 0, 0, 0) },
    fixtureHeight: { value: new Vector4() },
    shapeDetailAmounts: { value: new Vector4() },
    fixtureDetail: { value: 0 },
    mipLevel: { value: 0 },
    jitter: { value: 0 },
    fixtureCount: { value: false }
  }
  const sample = (expected: readonly number[], reads: number, label: string, tolerance = 1e-6): void => {
    uniforms.fixtureCount.value = false
    const density = draw(fragment, uniforms)
    check(
      density.every((value, i) => Number.isFinite(value) && Math.abs(value - expected[i]) < tolerance),
      `${label}: density ${density} != ${expected}`
    )
    uniforms.fixtureCount.value = true
    const counts = draw(fragment, uniforms)
    check(
      counts[0] === reads && counts[1] === reads && counts[2] === 0,
      `${label}: detail lookup/debug/implicit counts ${counts} != ${reads},${reads},0,1`
    )
  }
  for (const detail of [0, 0.25, 0.5, 1])
    for (const strength of [0, 0.65, 1]) {
      uniforms.fixtureDetail.value = detail
      uniforms.shapeDetailAmounts.value.setScalar(strength)
      uniforms.fixtureHeight.value.set(0.1, 0.3, 0.5, 1)
      sample([0, 0, 0, 0], 0, `empty/detail${detail}/strength${strength}`)
    }

  uniforms.shapeDetailAmounts.value.setScalar(0.5)
  uniforms.fixtureHeight.value.setScalar(0.6)
  for (let channel = 0; channel < 4; channel++) {
    uniforms.fixtureDensity.value.setScalar(0).setComponent(channel, 0.25)
    uniforms.fixtureDetail.value = 0
    // At the upper profile, detail=0 and strength=.5 remap density=.25 to 1/3.
    const expected = [0, 0, 0, 0]
    expected[channel] = 1 / 3
    sample(expected, 1, `contributing channel ${channel}`)

    // The shortcut is exact zero, not an epsilon cutoff for faint cloud edges.
    uniforms.fixtureDensity.value.setComponent(channel, 1e-8)
    uniforms.fixtureDetail.value = 1
    expected[channel] = 2e-8
    sample(expected, 1, `faint channel ${channel}`, 1e-12)
  }

  uniforms.fixtureDensity.value.setScalar(0.25)
  uniforms.fixtureDetail.value = 0
  uniforms.mipLevel.value = 1
  for (const [jitter, reads, expected] of [
    [0.499, 1, 1 / 3],
    [0.5, 0, 0.25],
    [0.999, 0, 0.25]
  ]) {
    uniforms.jitter.value = jitter
    sample([expected, expected, expected, expected], reads, `distance LOD boundary jitter ${jitter}`)
  }
}
