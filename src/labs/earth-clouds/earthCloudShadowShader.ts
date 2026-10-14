// Shadow sampler adapted from @takram/three-atmosphere and three-geospatial.
// Copyright (c) 2024 Shota Matsuda. MIT License; see public/licenses/takram-three-geospatial.txt.
const signatures: [string, string, readonly string[]][] = [
  ['raySphereSecondIntersection', 'float', ['vec3', 'vec3', 'vec3', 'float']],
  ['remapClamped', 'float', ['float', 'float', 'float', 'float', 'float']],
  ['interleavedGradientNoise', 'float', ['vec2']],
  ['vogelDisk', 'vec2', ['int', 'int', 'float']],
  ['getFadedCascadeIndex', 'int', ['mat4', 'vec3', 'vec2[SHADOW_CASCADE_COUNT]', 'float', 'float', 'float']],
  ['getSTBN', 'float', []],
  ['getShadowUv', 'vec2', ['vec3', 'int']],
  ['getDistanceToShadowTop', 'float', ['vec3']],
  ['readShadowOpticalDepth', 'float', ['vec2', 'float', 'int']],
  ['sampleShadowOpticalDepthPCF', 'float', ['vec3', 'float', 'float', 'int']],
  ['sampleShadowOpticalDepth', 'float', ['vec3', 'vec3', 'float', 'float']],
  ['getShadowRadius', 'float', ['vec3']]
]
// Input and precision qualifiers do not change the callable type. Output and
// inout qualifiers do, so they deliberately fail the expected input schema.
function parameterType(parameter: string): string | null {
  const match = parameter.trim().match(/^(?:(?:const|in|lowp|mediump|highp)\s+)*(\w+)\s+\w+\s*(\[\s*\w+\s*\])?$/)
  return match ? match[1] + (match[2]?.replace(/\s/g, '') ?? '') : null
}
function extract(source: string, name: string, result: string, parameters: readonly string[]): string {
  const candidates = [...source.matchAll(new RegExp(`\\b${result}\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`, 'g'))].filter(
    (m) => {
      const actual = m[1].trim() ? m[1].split(',').map(parameterType) : []
      return actual.length === parameters.length && actual.every((type, i) => type === parameters[i])
    }
  )
  if (candidates.length !== 1)
    throw new Error(`Earth shadow shader signature changed: ${name} (${candidates.length} matches)`)
  const match = candidates[0],
    start = match.index!,
    brace = start + match[0].length - 1
  let depth = 1,
    end = brace + 1
  while (depth && end < source.length) {
    if (source[end] === '{') depth++
    if (source[end] === '}') depth--
    end++
  }
  if (depth) throw new Error(`Earth shadow shader unterminated: ${name}`)
  return source.slice(start, end)
}
export function buildEarthCloudShadowGLSL(reference: string): string {
  let closure = signatures.map(([name, result, parameters]) => extract(reference, name, result, parameters)).join('\n')
  if (!closure.includes('distanceFade')) throw new Error('Earth shadow shader missing distance fade')
  const names = [
    ...signatures.map((s) => s[0]),
    'viewZToOrthographicDepth',
    'shadowBuffer',
    'shadowIntervals',
    'shadowMatrices',
    'inverseShadowMatrices',
    'shadowFar',
    'shadowTopHeight',
    'shadowRadius',
    'cameraNear',
    'projectionMatrix',
    'viewMatrix',
    'resolution',
    'frame',
    'stbnTexture',
    'bottomRadius',
    'sunDirection'
  ]
  for (const name of names)
    closure = closure.replace(new RegExp(`\\b${name}\\b`, 'g'), 'earthShadow' + name[0].toUpperCase() + name.slice(1))
  closure = closure
    .replace(/\bSHADOW_CASCADE_COUNT\b/g, 'EARTH_SHADOW_CASCADE_COUNT')
    .replace(/\bSHADOW_SAMPLE_COUNT\b/g, 'EARTH_SHADOW_SAMPLE_COUNT')
    .replace(/\bMETER_TO_LENGTH_UNIT\b/g, 'EARTH_SHADOW_METER_TO_LENGTH_UNIT')
  return `precision highp sampler3D;
  precision highp sampler2DArray;
  #define EARTH_SHADOW_SAMPLE_COUNT 8
  #define EARTH_SHADOW_METER_TO_LENGTH_UNIT 0.001
  uniform bool earthShadowEnabled;
  uniform sampler2DArray earthShadowShadowBuffer;
  uniform sampler3D earthShadowStbnTexture;
  uniform vec2 earthShadowShadowIntervals[EARTH_SHADOW_CASCADE_COUNT];
  uniform mat4 earthShadowShadowMatrices[EARTH_SHADOW_CASCADE_COUNT];
  uniform mat4 earthShadowInverseShadowMatrices[EARTH_SHADOW_CASCADE_COUNT];
  uniform float earthShadowShadowFar, earthShadowShadowTopHeight, earthShadowShadowRadius, earthShadowCameraNear, earthShadowBottomRadius;
  uniform mat4 earthShadowProjectionMatrix, earthShadowViewMatrix, earthWorldToECEF;
  uniform vec2 earthShadowResolution;
  uniform vec3 earthShadowSunDirection;
  uniform int earthShadowFrame;
  float earthShadowViewZToOrthographicDepth(float z,float n,float f) { return (z+n)/(n-f); }
  ${closure}
  float earthSampleSunTransmittance(vec3 worldPosition) {
    if(!earthShadowEnabled)return 1.0;
    vec3 positionECEFkm=(earthWorldToECEF * vec4(worldPosition,1.0)).xyz * 0.001;
    float radius=earthShadowGetShadowRadius(worldPosition);
    float tau=earthShadowSampleShadowOpticalDepth(worldPosition,positionECEFkm,radius,earthShadowGetSTBN());
    return exp(-tau);
  }`
}
