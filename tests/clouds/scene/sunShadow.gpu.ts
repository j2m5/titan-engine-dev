import type { ShaderMaterial } from 'three'

/** Run the installed sun march with an analytic medium and its complementary shadow-map tail. */
export function checkSceneCloudSunShadow(
  shader: string,
  draw: (fragment: string, uniforms: ShaderMaterial['uniforms']) => number[],
  check: (condition: boolean, label: string) => void
): void {
  const name = shader.match(/float opticalDepth = (\w+)\(/)?.[1]
  if (!name) throw new Error('Missing production sun optical-depth call')
  const march = shader.match(new RegExp(`float ${name}\\([^]*?\\n\\}`))?.[0]
  if (!march) throw new Error('Missing production sun optical-depth function')
  const intersection = shader.match(/float raySphereSecondIntersection\([^]*?\n\}/)?.[0]
  if (!intersection) throw new Error('Missing production ray/sphere intersection')
  const fragment = `
uniform float fixtureLength, fixtureExtinction, fixtureJitter, fixtureMip;
uniform int fixtureBudget;
uniform bool fixtureBlocker, fixtureRamp, fixtureSphere;
const float bottomRadius = 6360000.0, maxHeight = 8000.0, minSecondaryStepSize = 100.0, secondaryStepScale = 2.0;
int fixtureSamples = 0;
bool fixtureOutOfBounds = false;
struct WeatherSample { float density; };
struct MediaSample { float extinction; };
float remap(float x, float a, float b, float c, float d) { return mix(c, d, (x-a)/(b-a)); }
vec2 getGlobeUv(vec3 position) { return vec2(0.0); }
// No shadow-map layer in the real sphere case: local self-shadow still reaches the cloud top.
float getDistanceToShadowTop(vec3 position) { return fixtureSphere ? 0.0 : fixtureLength; }
${intersection.replace('float raySphereSecondIntersection(', 'float fixtureSphereIntersection(')}
float raySphereSecondIntersection(vec3 origin, vec3 direction, vec3 center, float radius) {
  return fixtureSphere ? fixtureSphereIntersection(origin, direction, center, radius) : fixtureLength;
}
WeatherSample sampleWeather(vec2 uv, float height, float mip) { return WeatherSample(1.0); }
MediaSample sampleMedia(WeatherSample weather, vec3 position, vec2 uv, float mip, float jitter) {
  fixtureSamples++;
  float distance = position.x - (fixtureSphere ? bottomRadius + maxHeight - fixtureLength : 0.0);
  fixtureOutOfBounds = fixtureOutOfBounds || distance < 0.0 || distance > fixtureLength;
  float density = fixtureRamp ? distance : fixtureBlocker ? float(distance >= 200.0 && distance <= 1000.0) : 1.0;
  return MediaSample(fixtureExtinction * density);
}
${march}
void main() {
  float distance;
  vec3 origin = fixtureSphere ? vec3(bottomRadius + maxHeight - fixtureLength,0.0,0.0) : vec3(0.0);
  float local = ${name}(origin, vec3(1.0,0.0,0.0), fixtureBudget, fixtureMip, fixtureJitter, distance);
  float tail = fixtureBlocker ? 0.0 : fixtureExtinction * max(0.0, fixtureLength - distance);
  gl_FragColor = vec4(local + tail, distance, local, float(fixtureSamples) * (fixtureOutOfBounds ? -1.0 : 1.0));
}`
  const sample = (
    budget: number,
    mip: number,
    jitter: number,
    length: number,
    extinction: number,
    blocker = false,
    ramp = false,
    sphere = false
  ): number[] =>
    draw(fragment, {
      fixtureBudget: { value: budget },
      fixtureMip: { value: mip },
      fixtureJitter: { value: jitter },
      fixtureLength: { value: length },
      fixtureExtinction: { value: extinction },
      fixtureBlocker: { value: blocker },
      fixtureRamp: { value: ramp },
      fixtureSphere: { value: sphere }
    })
  for (const budget of [1, 2, 4])
    for (const mip of [0, 0.5, 1, 2])
      for (const jitter of [0, 0.25, 0.5, 0.99])
        for (const length of [120, 4000]) {
          const value = sample(budget, mip, jitter, length, 0.001)
          const label = `sun partition budget${budget}/mip${mip}/jitter${jitter}/length${length}: ${value}`
          check(value.every(Number.isFinite), `${label}: finite`)
          check(Math.abs(value[0] - length * 0.001) < 1e-5, `${label}: each metre counted once`)
          check(value[1] >= 0 && value[1] <= length + 1e-4, `${label}: tail starts inside ray`)
          check(value[3] >= 0 && value[3] <= budget, `${label}: sample budget and bounds`)
        }
  for (const mip of [0, 0.5, 1, 2]) {
    const empty = sample(2, mip, 0.5, 4000, 0)
    check(empty[0] === 0, `clear sun ray has no synthetic optical depth at mip ${mip}: ${empty}`)
  }
  const blocker = sample(2, 0, 0.5, 4000, 0.001, true)
  check(blocker[2] > 0.1, `medium sun ray detects sub-kilometre blocker beyond immediate sample: ${blocker}`)
  for (const budget of [1, 2, 4])
    for (const jitter of [0, 0.25, 0.5, 0.99]) {
      const ramp = sample(budget, 0, jitter, 4000, 0.000001, false, true)
      const integral = 0.5 * 0.000001 * ramp[1] ** 2
      check(Math.abs(ramp[2] - integral) < 1e-5, `linear sun extinction integrates independently of jitter: ${ramp}`)
    }
  for (const length of [0.5, 120]) {
    const nearTop = sample(2, 0, 0.25, length, 0.001, false, false, true)
    check(Math.abs(nearTop[1] - length) <= 0.5, `real Earth sphere clips local march at cloud top: ${nearTop}`)
    check(Math.abs(nearTop[2] - length * 0.001) < 0.0006, `no-shadow-map layer retains local extinction: ${nearTop}`)
    check(nearTop[3] === 2, `near-top samples remain inside the real cloud sphere: ${nearTop}`)
  }
}
