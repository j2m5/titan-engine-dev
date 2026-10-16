import { atmosphereShader } from '@/core/renderables/Atmosphere/atmosphere'
import { replaceExactlyOnce } from '@/core/clouds/appearance/cloudAppearanceShader'

/** Extract definitions, excluding public overloads below RADIANCE_API_ENABLED.
 * The main source owns its corrected segment and Mie math. No forked GLSL copy.
 */
export function buildMainCloudAerialKernel(source = atmosphereShader): string {
  const marker = '#define RADIANCE_API_ENABLED'
  const cut = source.indexOf(marker)
  const core = (cut < 0 ? source : source.slice(0, cut)).replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, '')
  const names = [
    'SafeTransmittanceRatio',
    'GetTransmittance',
    'GetExtrapolatedSingleMieScattering',
    'GetCombinedScattering',
    'GetSkyRadianceToPoint'
  ]
  return names
    .map((name) => {
      const matches = [
        ...core.matchAll(
          new RegExp(`\\b(?:vec3|DimensionlessSpectrum|IrradianceSpectrum|RadianceSpectrum)\\s+${name}\\s*\\(`, 'g')
        )
      ]
      if (matches.length !== 1)
        throw new Error(`Scene cloud main aerial ${name}: expected one definition, found ${matches.length}`)
      const start = matches[0].index!
      const brace = core.indexOf('{', start)
      if (brace < 0) throw new Error(`Scene cloud main aerial ${name}: missing body`)
      let depth = 1,
        end = brace + 1
      for (; end < core.length && depth; end++) {
        if (core[end] === '{') depth++
        else if (core[end] === '}') depth--
      }
      if (depth) throw new Error(`Scene cloud main aerial ${name}: incomplete body`)
      let definition = core
        .slice(start, end)
        .replace(/\bIN\((\w+)\)/g, 'const $1')
        .replace(/\bOUT\((\w+)\)/g, 'out $1')
      for (const dependency of names)
        definition = definition.replace(new RegExp(`\\b${dependency}\\b`, 'g'), `sceneCloud${dependency}`)
      return definition
    })
    .join('\n')
}

export const sceneCloudAerialUniformsGlsl = `
uniform float sceneCloudAtmosphereExposure;
uniform float sceneCloudAtmosphereHdrKnee;
`

/** Same top/bottom clipping and eclipse sample as the main atmosphere slot, in body-local km. */
export function adaptSceneCloudAerial(source: string): string {
  const replacement = `
#undef GetSkyRadianceToPoint
${buildMainCloudAerialKernel()}
#define GetSkyRadianceToPoint GetSkyLuminanceToPoint
void applyAerialPerspective(
  const vec3 cameraPosition, const vec3 frontPosition,
  const float shadowLength, inout vec4 color
) {
  vec3 origin = cameraPosition * .001;
  vec3 endpoint = frontPosition * .001;
  float distKm = length(endpoint - origin);
  if (distKm <= 1e-6) return;
  vec3 dir = (endpoint - origin) / distKm;
  float b = -dot(dir, origin);
  float cc = dot(origin, origin);
  float c = cc - ATMOSPHERE.top_radius * ATMOSPHERE.top_radius;
  float disc = b * b - c;
  if (disc <= 0.0) return;
  float root = sqrt(disc);
  float tExit = b + root;
  if (tExit <= 0.0) return;
  float t0 = c < 0.0 ? 0.0 : b - root;
  if (t0 >= distKm) return;
  bool hitSurface = distKm < tExit;
  float t1 = hitSurface ? distKm : tExit;
  float cBottom = cc - ATMOSPHERE.bottom_radius * ATMOSPHERE.bottom_radius;
  float discBottom = b * b - cBottom;
  if (cBottom > 0.0 && discBottom > 0.0) {
    float tBottom = b - sqrt(discBottom);
    if (tBottom > 0.0 && tBottom < t1) { t1 = tBottom; hitSurface = true; }
  }
  vec3 p0 = origin + dir * t0;
  vec3 p1 = origin + dir * t1;
  float r0 = length(p0), r1 = length(p1);
  p0 *= max(r0, ATMOSPHERE.bottom_radius + .01) / max(r0, 1e-6);
  p1 *= max(r1, ATMOSPHERE.bottom_radius + .01) / max(r1, 1e-6);
  vec3 transmittance;
  vec3 radiance = sceneCloudGetSkyRadianceToPoint(ATMOSPHERE, transmittance_texture, scattering_texture, scattering_texture,
    p0, p1, 0.0, sunDirection, transmittance);
  vec3 sceneCloudScatter = radiance * sceneCloudAtmosphereExposure;
  vec3 sceneCloudEclipseQ = hitSurface ? (origin + dir * t1) : (origin + dir * clamp(b, t0, t1));
  sceneCloudScatter *= eclipseLightAt(sceneCloudEclipseQ, sceneCloudEclipseCount, sceneCloudEclipseOcc,
    sceneCloudEclipseStar, sceneCloudEclipseStarRadius, sceneCloudEclipseUmbra);
  vec3 sceneCloudExcess = max(sceneCloudScatter - vec3(1.0), vec3(0.0));
  sceneCloudScatter = min(sceneCloudScatter, vec3(1.0)) + sceneCloudExcess * sceneCloudAtmosphereHdrKnee;
  sceneCloudScatter = min(sceneCloudScatter, vec3(64.0));
  color.rgb = color.rgb * transmittance + color.a * sceneCloudScatter;
}`
  return replaceExactlyOnce(
    source,
    /void applyAerialPerspective\([^]*?\n\}/g,
    replacement,
    'scene cloud',
    'applyAerialPerspective'
  )
}
