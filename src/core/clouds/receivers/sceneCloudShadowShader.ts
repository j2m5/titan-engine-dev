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
    throw new Error(`Scene cloud shadow shader signature changed: ${name} (${candidates.length} matches)`)
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
  if (depth) throw new Error(`Scene cloud shadow shader unterminated: ${name}`)
  return source.slice(start, end)
}
export function buildSceneCloudShadowGLSL(reference: string): string {
  let closure = signatures.map(([name, result, parameters]) => extract(reference, name, result, parameters)).join('\n')
  // The main receiver starts with the pinned public shader. Labs may already
  // have applied this same far-cascade fade before extracting the closure.
  if (!closure.includes('distanceFade')) {
    const sampler = extract(reference, 'sampleShadowOpticalDepth', 'float', ['vec3', 'vec3', 'float', 'float'])
    const canonical =
      /float sampleShadowOpticalDepth\(\s*const vec3 worldPosition,\s*const vec3 positionECEF,\s*const float radius,\s*const float jitter\s*\) \{\s*float distanceToTop = getDistanceToShadowTop\(positionECEF\);\s*if \(distanceToTop <= 0\.0\) \{\s*return 0\.0;\s*\}\s*int cascadeIndex = getFadedCascadeIndex\(\s*viewMatrix,\s*worldPosition,\s*shadowIntervals,\s*cameraNear,\s*shadowFar,\s*jitter\s*\);\s*return cascadeIndex >= 0\s*\? sampleShadowOpticalDepthPCF\(worldPosition, distanceToTop, radius, cascadeIndex\)\s*: 0\.0;\s*\}/
    if (!canonical.test(sampler)) throw new Error('Scene cloud shadow raw sampler shape changed')
    const anchor = 'int cascadeIndex = getFadedCascadeIndex('
    if (closure.split(anchor).length !== 2) throw new Error('Scene cloud shadow fade anchor changed')
    closure = closure
      .replace(
        anchor,
        `float receiverDistance = -(viewMatrix * vec4(worldPosition, 1.0)).z;
      float distanceFade = 1.0 - smoothstep(shadowFar * 0.8, shadowFar, receiverDistance);
      if (distanceFade <= 0.0) return 0.0;
      int cascadeIndex = getFadedCascadeIndex(`
      )
      .replace('return cascadeIndex >= 0', 'return distanceFade * (cascadeIndex >= 0')
      .replace(/: 0\.0;\s*\}/, ': 0.0);\n}')
  }
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
    closure = closure.replace(
      new RegExp(`\\b${name}\\b`, 'g'),
      'sceneCloudShadow' + name[0].toUpperCase() + name.slice(1)
    )
  closure = closure
    .replace(/\bSHADOW_CASCADE_COUNT\b/g, 'SCENE_CLOUD_SHADOW_CASCADE_COUNT')
    .replace(/\bSHADOW_SAMPLE_COUNT\b/g, 'SCENE_CLOUD_SHADOW_SAMPLE_COUNT')
    .replace(/\bMETER_TO_LENGTH_UNIT\b/g, 'SCENE_CLOUD_SHADOW_METER_TO_LENGTH_UNIT')
  return `#ifdef SCENE_CLOUD_NEAR
  precision highp sampler3D;
  precision highp sampler2DArray;
  #define SCENE_CLOUD_SHADOW_SAMPLE_COUNT 8
  #define SCENE_CLOUD_SHADOW_METER_TO_LENGTH_UNIT 0.001
  uniform bool sceneCloudShadowEnabled;
  uniform sampler2DArray sceneCloudShadowShadowBuffer;
  uniform sampler3D sceneCloudShadowStbnTexture;
  uniform vec2 sceneCloudShadowShadowIntervals[SCENE_CLOUD_SHADOW_CASCADE_COUNT];
  uniform mat4 sceneCloudShadowShadowMatrices[SCENE_CLOUD_SHADOW_CASCADE_COUNT];
  uniform mat4 sceneCloudShadowInverseShadowMatrices[SCENE_CLOUD_SHADOW_CASCADE_COUNT];
  uniform float sceneCloudShadowShadowFar, sceneCloudShadowShadowTopHeight, sceneCloudShadowShadowRadius, sceneCloudShadowCameraNear, sceneCloudShadowBottomRadius;
  uniform mat4 sceneCloudShadowProjectionMatrix, sceneCloudShadowViewMatrix;
  uniform vec2 sceneCloudShadowResolution;
  uniform vec3 sceneCloudShadowSunDirection;
  uniform int sceneCloudShadowFrame;
  float sceneCloudShadowViewZToOrthographicDepth(float z,float n,float f) { return (z+n)/(n-f); }
  ${closure}
  float sceneCloudSampleSunTransmittanceMeters(vec3 positionMeters) {
    if(!sceneCloudShadowEnabled)return 1.0;
    float radius=sceneCloudShadowGetShadowRadius(positionMeters);
    float tau=sceneCloudShadowSampleShadowOpticalDepth(positionMeters,positionMeters * 0.001,radius,sceneCloudShadowGetSTBN());
    return exp(-tau);
  }
  #else
  float sceneCloudSampleSunTransmittanceMeters(vec3 positionMeters) { return 1.0; }
  #endif`
}
