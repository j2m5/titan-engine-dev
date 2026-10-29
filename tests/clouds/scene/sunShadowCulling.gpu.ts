import type { ShaderMaterial } from 'three'
import { sceneCloudLightGLSL } from '@/core/clouds/receivers/sceneCloudLight'

/** Execute the installed solar block: dark samples must not read density or the shadow map. */
export function checkSceneCloudSunShadowCulling(
  shader: string,
  draw: (fragment: string, uniforms: ShaderMaterial['uniforms']) => number[],
  check: (condition: boolean, label: string) => void
): void {
  const march = shader.match(/float sceneCloudMarchSunOpticalDepth\([^]*?\n\}/)?.[0]
  const block = shader.match(
    / {6}\/\/ March optical depth to the sun[^]*?(?= {6}vec3 radiance = vec3\(0.0\);)/
  )?.[0]
  if (!march || !block) throw new Error('Missing installed scene sun march or its call site')
  const fragment = `
uniform float fixtureMu, fixtureHeight, fixtureLambert;
uniform int maxIterationCountToSun;
uniform bool fixtureLight;
const float bottomRadius = 6360000.0, maxHeight = 8000.0, shadowTopHeight = 8000.0;
const float maxShadowFilterRadius = 1.0, mipLevel = 0.0, jitter = 0.5;
int fixtureSamples = 0, fixtureTailSamples = 0;
float fixtureTailStart = 0.0;
struct WeatherSample { float density; };
struct MediaSample { float extinction; };
float remap(float x, float a, float b, float c, float d) { return mix(c, d, (x-a)/(b-a)); }
float remapClamped(float x, float a, float b) { return clamp((x-a)/(b-a), 0.0, 1.0); }
float raySphereSecondIntersection(vec3 origin, vec3 direction, vec3 center, float radius) { return 1200.0; }
vec2 getGlobeUv(vec3 position) { return vec2(0.0); }
WeatherSample sampleWeather(vec2 uv, float height, float mip) { return WeatherSample(1.0); }
MediaSample sampleMedia(WeatherSample weather, vec3 position, vec2 uv, float mip, float jitter) {
  fixtureSamples++;
  return MediaSample(0.001);
}
float sampleShadowOpticalDepth(vec3 position, float start, float radius, float jitter) {
  fixtureTailSamples++;
  fixtureTailStart = start;
  return 0.8;
}
${sceneCloudLightGLSL}
${march}
void main() {
  vec3 surfaceNormal = vec3(sqrt(1.0-fixtureMu*fixtureMu), 0.0, fixtureMu);
  vec3 sunDirection = vec3(0.0, 0.0, 1.0);
  vec3 position = surfaceNormal * (bottomRadius + fixtureHeight);
  float height = fixtureHeight;
${block}
  vec3 direct, ambient;
  sceneCloudSplitLight(fixtureMu, vec3(1.0), vec3(0.5), vec3(1.0), fixtureLambert, 0.6, direct, ambient);
  gl_FragColor = fixtureLight
    ? vec4(direct.x, ambient.x, float(fixtureSamples), float(fixtureTailSamples))
    : vec4(opticalDepth, float(fixtureSamples), float(fixtureTailSamples), fixtureTailStart);
}`
  // The reference ramp starts at -0.08; even its first nonzero twilight samples keep full shadows.
  for (const [mu, lit] of [
    [-1, false],
    [-0.0801, false],
    [-0.08, false],
    [-0.0799, true],
    [-0.04, true],
    [0, true],
    [0.5, true],
    [1, true]
  ] as const)
    for (const budget of [1, 2, 4])
      for (const [height, tail] of [
        [6000, true],
        [8500, false]
      ] as const) {
        const value = draw(fragment, {
          fixtureMu: { value: mu },
          fixtureHeight: { value: height },
          maxIterationCountToSun: { value: budget },
          fixtureLight: { value: false },
          fixtureLambert: { value: 0.8 }
        })
        const label = `sun culling mu${mu}/budget${budget}/height${height}: ${value}`
        check(value.every(Number.isFinite), `${label}: finite`)
        check(Math.abs(value[0] - (lit ? (tail ? 2.0 : 1.2) : 0.0)) < 1e-6, `${label}: optical depth`)
        check(value[1] === (lit ? budget : 0), `${label}: local density sample budget`)
        check(value[2] === (lit && tail ? 1 : 0), `${label}: shadow-map sample budget`)
        check(value[3] === (lit && tail ? 1200 : 0), `${label}: complementary tail offset`)
      }
  for (const mu of [-1, -0.0801, -0.08])
    for (const [lambert, ambient] of [
      [0, 0],
      [0.8, 0.24],
      [1, 0.3]
    ]) {
      const value = draw(fragment, {
        fixtureMu: { value: mu },
        fixtureHeight: { value: 6000 },
        maxIterationCountToSun: { value: 4 },
        fixtureLight: { value: true },
        fixtureLambert: { value: lambert }
      })
      check(value[0] === 0, `culled sun has exactly zero reference direct light at ${mu}/${lambert}: ${value}`)
      check(Math.abs(value[1] - ambient) < 1e-6, `night ambient survives at ${mu}/${lambert}: ${value}`)
      check(value[2] === 0 && value[3] === 0, `night ambient needs no solar shadow samples: ${value}`)
    }
}
