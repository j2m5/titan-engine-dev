import { CloudsEffect } from '@takram/three-clouds'
import { PerspectiveCamera, Vector2, Vector3, type ShaderMaterial } from 'three'
import { adaptSceneCloudStationaryWeather } from '@/core/clouds/takram/sceneCloudStationaryWeather'

/** Execute the installed weather evolution block and observe redundant
 * normalization separately from its zero contribution to texture positions. */
export function checkSceneCloudStationaryWeather(
  source: string,
  draw: (fragment: string, uniforms: ShaderMaterial['uniforms']) => number[],
  check: (condition: boolean, label: string) => void
): void {
  const fragmentFor = (shader: string): string => {
    const start = shader.indexOf('// TODO: Define in physical length.', shader.indexOf('MediaSample sampleMedia(')),
      end = shader.indexOf('  vec3 turbulence = vec3(0.0);', start)
    if (start < 0 || end < start) throw new Error('Missing production weather evolution block')
    return `
uniform vec3 fixturePosition;
uniform vec2 localWeatherOffset;
uniform bool fixtureCount;
int fixtureNormalizations = 0;
vec3 fixtureNormalize(vec3 value) {
  ++fixtureNormalizations;
  return normalize(value);
}
#define normalize fixtureNormalize
void main() {
  vec3 position = fixturePosition;
${shader.slice(start, end)}
  gl_FragColor = fixtureCount ? vec4(float(fixtureNormalizations)) : vec4(evolution, 1.0);
}
#undef normalize
`
  }
  const fragment = fragmentFor(source)
  const uniforms = {
    fixturePosition: { value: new Vector3() },
    localWeatherOffset: { value: new Vector2() },
    fixtureCount: { value: false }
  }
  for (const position of [
    [6366000, 0, 0],
    [0, -6366000, 0],
    [0, 0, 69917000]
  ]) {
    uniforms.fixturePosition.value.fromArray(position)
    uniforms.fixtureCount.value = false
    const value = draw(fragment, uniforms)
    check(
      value.every((v, i) => v === (i === 3 ? 1 : 0)),
      `stationary weather has zero evolution: ${value}`
    )
    uniforms.fixtureCount.value = true
    const count = draw(fragment, uniforms)
    check(
      count.every((v) => v === 0),
      `stationary weather avoids unused normalization: ${count}`
    )
  }

  const effect = new CloudsEffect(new PerspectiveCamera())
  try {
    const original = effect.cloudsPass.currentMaterial.fragmentShader
    for (const { offset, velocity } of [
      { offset: [1, 0], velocity: [0, 0] },
      { offset: [0, -1], velocity: [0, 0] },
      { offset: [0, 0], velocity: [1, 0] },
      { offset: [0, 0], velocity: [0, -1] }
    ]) {
      effect.localWeatherOffset.fromArray(offset)
      effect.localWeatherVelocity.fromArray(velocity)
      const fallback = fragmentFor(adaptSceneCloudStationaryWeather(original, effect))
      uniforms.fixturePosition.value.set(0, 0, 6366000)
      uniforms.localWeatherOffset.value.copy(effect.localWeatherOffset)
      uniforms.fixtureCount.value = true
      const count = draw(fallback, uniforms)
      check(
        count.every((v) => v === 1),
        `moving/displaced weather retains normalization: ${count}`
      )
      // An initially zero offset must still evolve after this shader is created.
      uniforms.localWeatherOffset.value.add(effect.localWeatherVelocity)
      uniforms.fixtureCount.value = false
      const value = draw(fallback, uniforms)
      check(
        value.every((v, i) => Math.abs(v - [0, 0, -20000, 1][i]) < 0.01),
        `moving/displaced weather retains radial evolution: ${value}`
      )
    }
  } finally {
    effect.dispose()
  }
}
