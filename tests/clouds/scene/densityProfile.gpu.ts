import { CloudsEffect } from '@takram/three-clouds'
import { PerspectiveCamera, Vector4, type ShaderMaterial } from 'three'
import { adaptSceneCloudDensityProfile } from '@/core/clouds/takram/sceneCloudDensityProfile'

/** Execute the installed density formula. The counter makes redundant exponent
 * evaluation observable even when its zero coefficient preserves the color. */
export function checkSceneCloudDensityProfile(
  source: string,
  draw: (fragment: string, uniforms: ShaderMaterial['uniforms']) => number[],
  check: (condition: boolean, label: string) => void
): void {
  const fragmentFor = (shader: string): string => {
    const profile = shader.match(/vec4 getLayerDensity\([^]*?\n\}/)?.[0]
    if (!profile) throw new Error('Missing production density profile function')
    return `
struct CloudDensityProfile {
  vec4 expTerms, exponents, linearTerms, constantTerms;
};
uniform CloudDensityProfile densityProfile;
uniform vec4 fixtureHeight;
uniform bool fixtureCount;
int fixtureExponentCalls = 0;
vec4 fixtureExp(vec4 value) {
  ++fixtureExponentCalls;
  return exp(value);
}
#define exp fixtureExp
${profile}
#undef exp
void main() {
  vec4 density = getLayerDensity(fixtureHeight);
  gl_FragColor = fixtureCount ? vec4(float(fixtureExponentCalls)) : density;
}`
  }
  const fragment = fragmentFor(source)
  for (const { linear, constant, expected } of [
    { linear: [0.75, 0.75, 0.75, 0.75], constant: [0.25, 0.25, 0.25, 0.25], expected: [0.25, 0.4375, 0.625, 1] },
    { linear: [1, 2, -0.5, 0], constant: [0, 0.25, 1, 0.75], expected: [0, 0.75, 0.75, 0.75] }
  ]) {
    const uniforms = {
      fixtureHeight: { value: new Vector4(0, 0.25, 0.5, 1) },
      fixtureCount: { value: false },
      densityProfile: {
        value: {
          expTerms: new Vector4(0, 0, 0, 0),
          exponents: new Vector4(0, 0, 0, 0),
          linearTerms: new Vector4().fromArray(linear),
          constantTerms: new Vector4().fromArray(constant)
        }
      }
    }
    const value = draw(fragment, uniforms)
    check(
      value.every((v, i) => Math.abs(v - expected[i]) < 1e-6),
      `linear density profile: ${value} != ${expected}`
    )
    uniforms.fixtureCount.value = true
    const count = draw(fragment, uniforms)
    check(
      count.every((v) => v === 0),
      `linear density does not evaluate unused exponentials: ${count}`
    )
  }

  // A later profile in any channel must disable specialization. These values
  // also exercise a nonzero coefficient with zero exponent, and vice versa.
  const effect = new CloudsEffect(new PerspectiveCamera())
  try {
    for (const { channel, term, exponent, expected } of [
      { channel: 3, term: 0.5, exponent: Math.LN2, expected: [0.25, 0.4375, 0.625, 2] },
      { channel: 0, term: 0.5, exponent: 0, expected: [0.75, 0.4375, 0.625, 1] },
      { channel: 0, term: 0, exponent: 1, expected: [0.25, 0.4375, 0.625, 1] }
    ]) {
      effect.cloudLayers.reset()
      effect.cloudLayers[channel].densityProfile.expTerm = term
      effect.cloudLayers[channel].densityProfile.exponent = exponent
      const shader = adaptSceneCloudDensityProfile(effect.cloudsPass.currentMaterial.fragmentShader, effect.cloudLayers)
      const uniforms = {
        fixtureHeight: { value: new Vector4(0, 0.25, 0.5, 1) },
        fixtureCount: { value: false },
        densityProfile: {
          value: {
            expTerms: effect.cloudLayers.packDensityProfiles('expTerm', new Vector4()),
            exponents: effect.cloudLayers.packDensityProfiles('exponent', new Vector4()),
            linearTerms: effect.cloudLayers.packDensityProfiles('linearTerm', new Vector4()),
            constantTerms: effect.cloudLayers.packDensityProfiles('constantTerm', new Vector4())
          }
        }
      }
      const value = draw(fragmentFor(shader), uniforms)
      check(
        value.every((v, i) => Math.abs(v - expected[i]) < 1e-6),
        `full density profile: ${value} != ${expected}`
      )
      uniforms.fixtureCount.value = true
      const count = draw(fragmentFor(shader), uniforms)
      check(
        count.every((v) => v === 1),
        `nonlinear profile retains exponent evaluation: ${count}`
      )
    }
  } finally {
    effect.dispose()
  }
}
