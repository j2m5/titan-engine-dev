import { AbstractShader } from '@/core/materials/shaders/AbstractShader'
import { rgbCloudMapGLSL } from './rgbCloudMap'
import { buildEarthCloudShadowGLSL } from './earthCloudShadowShader'

function replace(source: string, anchor: string, replacement: string, stage: string): string {
  if (source.split(anchor).length !== 2) throw new Error(`Earth shader anchor changed: ${stage}`)
  return source.replace(anchor, replacement)
}
export function buildEarthSurfaceShader(
  vertexSource: string,
  fragmentSource: string,
  mode: 'far' | 'near',
  reference: string
) {
  let fragmentShader = AbstractShader.prepareSource(fragmentSource)
  const declarations = `uniform float earthLongitudeOffset;
  uniform mat4 earthPlanetToWorld;
  ${mode === 'far' ? `uniform sampler2D earthCloudMap; uniform bool earthSurfaceMapEnabled; ${rgbCloudMapGLSL}` : buildEarthCloudShadowGLSL(reference)}`
  fragmentShader = replace(fragmentShader, 'void main() {', `${declarations}\nvoid main() {`, 'main')
  fragmentShader = replace(
    fragmentShader,
    'vec2 uv = vUv;',
    `vec3 earthDirection = normalize(vPosition);
    float earthPhi = dot(earthDirection.xz, earthDirection.xz) > 1e-12 ? atan(earthDirection.z, -earthDirection.x) : 0.0;
    vec2 uv = vec2(fract(earthPhi / PI2 + earthLongitudeOffset / PI2), 1.0 - acos(clamp(earthDirection.y, -1.0, 1.0)) / PI);`,
    'canonical UV'
  )
  if (mode === 'far') {
    fragmentShader = replace(
      fragmentShader,
      'vec3 diffuseSample = texture2D(diffuseMap, uv).rgb;',
      `vec3 diffuseSample = texture2D(diffuseMap, uv).rgb;
      RgbCloudSample earthCloud = decodeRgbCloud(texture2D(earthCloudMap, uv).rgb);
      float earthCloudCoverage = earthSurfaceMapEnabled ? earthCloud.coverage : 0.0;`,
      'cloud decode'
    )
    fragmentShader = replace(
      fragmentShader,
      'vec3 surfaceAlbedo = diffuseSample * albedoMul;',
      `vec3 surfaceAlbedo = diffuseSample * albedoMul;
      surfaceAlbedo = mix(surfaceAlbedo, earthCloud.albedo, earthCloudCoverage);`,
      'cloud diffuse'
    )
    fragmentShader = replace(
      fragmentShader,
      'night *= nightGate;',
      'night *= nightGate * (1.0 - earthCloudCoverage);',
      'cloud night'
    )
  } else {
    fragmentShader = replace(
      fragmentShader,
      'float directGain = mix(1.0, occlusion, uTerrainOcclusionDirect) * cloudShadow;',
      `float earthSunTransmittance = earthSampleSunTransmittance((earthPlanetToWorld * vec4(vPosition, 1.0)).xyz);
      float directGain = mix(1.0, occlusion, uTerrainOcclusionDirect) * cloudShadow * earthSunTransmittance;`,
      'shadow direct'
    )
  }
  fragmentShader = replace(
    fragmentShader,
    'float specularIntensity = texture2D(specularMap, uv).r;',
    `float specularIntensity = texture2D(specularMap, uv).r * ${mode === 'far' ? '(1.0 - earthCloudCoverage)' : 'earthSunTransmittance'};`,
    'specular attenuation'
  )
  return { vertexShader: AbstractShader.prepareSource(vertexSource), fragmentShader }
}
