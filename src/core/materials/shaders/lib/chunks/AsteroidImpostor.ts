import { asteroidPoseFunctions } from './AsteroidPose'
import { asteroidAppearanceFunctions } from './AsteroidAppearance'
import { asteroidSurfaceFunctions } from './AsteroidSurface'
import { hash13Function } from './AsteroidShape'
import { noiseFunctions } from './Noise'
import { triplanarDetailFunctions, triplanarDetailUniforms } from './TriplanarDetail'
import { asteroidIceBillboardVertexDecl, asteroidIceVertexDecl, asteroidIceVertexSelect } from './AsteroidIce'
import { IMPOSTOR_SLOT_CAPACITY } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'

const varyings = /* glsl */`
  flat varying mat3 vAtlasViewToObject;
  varying vec3 vAtlasRayPoint;
  flat varying vec3 vAtlasFrames;
  flat varying vec3 vAtlasWeights;
  flat varying vec3 vAtlasParams;
`

const basisFunctions = /* glsl */`
  vec2 impostorSign(vec2 p) { return mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), p)); }
  mat3 impostorFrameBasis(float frame, float grid) {
    vec2 p = vec2(mod(frame, grid), floor(frame / grid)) / (grid - 1.0) * 2.0 - 1.0;
    vec3 direction = vec3(p, 1.0 - abs(p.x) - abs(p.y));
    if (direction.z < 0.0) direction.xy = (1.0 - abs(direction.yx)) * impostorSign(direction.xy);
    direction = normalize(direction);
    vec3 reference = abs(direction.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(reference, direction));
    return mat3(right, cross(direction, right), direction);
  }
`

const vertexFunctions = /* glsl */`
  uniform float uImpostorReady;
  uniform float uImpostorPhysicalSize;
  uniform vec4 uImpostorLayout;
  uniform int uImpostorSlotLayers[${IMPOSTOR_SLOT_CAPACITY}];
  uniform float uImpostorHalfExtents[${IMPOSTOR_SLOT_CAPACITY}];
  attribute float instanceArchetype;
  attribute float instanceDetailEnd;
  ${noiseFunctions}
  ${hash13Function}
  ${asteroidPoseFunctions}
  ${varyings}

  void impostorSelectFrames(vec3 direction) {
    direction /= abs(direction.x) + abs(direction.y) + abs(direction.z);
    vec2 p = direction.xy;
    if (direction.z < 0.0) p = (1.0 - abs(p.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), p));
    float grid = uImpostorLayout.x;
    vec2 cell = clamp((p * 0.5 + 0.5) * (grid - 1.0), 0.0, grid - 1.0);
    vec2 index = min(floor(cell), vec2(grid - 2.0));
    vec2 f = cell - index;
    float base = index.x + index.y * grid;
    if (f.x + f.y <= 1.0) {
      vAtlasFrames = vec3(base, base + 1.0, base + grid);
      vAtlasWeights = vec3(1.0 - f.x - f.y, f.x, f.y);
    } else {
      vAtlasFrames = vec3(base + grid + 1.0, base + grid, base + 1.0);
      vAtlasWeights = vec3(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y);
    }
  }
`

const vertexMain = /* glsl */`
  vAtlasParams = vec3(0.0);
  vAtlasViewToObject = mat3(1.0);
  vAtlasRayPoint = vec3(0.0);
  vAtlasFrames = vAtlasWeights = vec3(0.0);
  if (uImpostorReady > 0.5 && instanceDetailEnd > 0.0) {
    int slot = int(clamp(instanceArchetype, 0.0, ${IMPOSTOR_SLOT_CAPACITY - 1}.0));
    float h = uImpostorHalfExtents[slot];
    mat3 instanceLinear = mat3(instanceMatrix);
    if (h <= 0.0 || abs(determinant(instanceLinear)) < 1e-20) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float seed = hash13(instanceMatrix[3].xyz);
    mat3 spin = asteroidSpinMatrix(seed);
    mat3 a = mat3(modelViewMatrix) * instanceLinear * spin * uImpostorPhysicalSize;
    vAtlasViewToObject = inverse(a);
    vec3 center = (modelViewMatrix * vec4(instanceOrigin + instanceMatrix[3].xyz, 1.0)).xyz;
    vec3 cameraObject = -vAtlasViewToObject * center;
    bool perspective = isPerspectiveMatrix(projectionMatrix);
    impostorSelectFrames(perspective ? cameraObject : vAtlasViewToObject * vec3(0.0, 0.0, 1.0));
    vec3 extent = h * vec3(length(vec3(a[0].x, a[1].x, a[2].x)), length(vec3(a[0].y, a[1].y, a[2].y)), length(vec3(a[0].z, a[1].z, a[2].z)));
    vec2 halfSize = extent.xy;
    if (perspective) {
      float depth = max(-center.z, 1e-6);
      halfSize = (extent.xy + abs(center.xy) * extent.z / depth) * depth / max(depth - extent.z, 1e-6);
    }
    vec3 quad = center + vec3((uv * 2.0 - 1.0) * halfSize, 0.0);
    vAtlasRayPoint = vAtlasViewToObject * (perspective ? quad : vec3(quad.xy, 0.0));
    vAtlasParams = vec3(float(uImpostorSlotLayers[slot]), h, 1.0);
    vRingPos = center;
    vPlanetDirView = (modelViewMatrix * vec4(-uOriginOffset, 1.0)).xyz;
    vRingNormalView = normalize(mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0));
    vLightDirView = (viewMatrix * vec4(uLightPosition, 1.0)).xyz;
    vInstanceSeed = hashSurface11(seed + 3.17);
    vEllipse = vec4(vec3(hashSurface11(seed + 1.1), hashSurface11(seed + 2.2), hashSurface11(seed + 3.3)) * 40.0, 0.0);
    vUv = uv;
    vHalfExtent = h;
    vFade = instanceFade;
    float dist = length(center);
    #ifdef USE_CASCADE_FADE_RADIUS
      vDistanceFade = 1.0 - smoothstep(instanceMaxDistance * 0.6, instanceMaxDistance, dist);
    #else
      vDistanceFade = 1.0 - smoothstep(uMaxDistance * 0.6, uMaxDistance, dist);
    #endif
    gl_Position = projectionMatrix * vec4(quad, 1.0);
    return;
  }
`

const fragmentFunctions = /* glsl */`
  uniform highp sampler2DArray uImpostorNormalDepth;
  uniform highp sampler2DArray uImpostorSurfaceCoverage;
  uniform vec4 uImpostorLayout;
  uniform float uImpostorPhysicalSize;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  uniform vec3 uOriginOffset;
  uniform vec3 uRockColor;
  uniform float uTintStrength;
  uniform float uMariaStrength;
  uniform float uSurfaceAmbient;
  uniform float uSpecularStrength;
  uniform float uSpecularPower;
  uniform float uSpecularTint;
  uniform float uFreshnessBrighten;
  uniform float uCavityShade;
  #ifdef USE_ICE_VARIETY
    uniform float uIceSpecularStrength;
    uniform float uIceSpecularPower;
    uniform float uIceSpecularTint;
    uniform float uIceSurfaceAmbient;
  #endif
  ${varyings}
  ${noiseFunctions}
  ${asteroidSurfaceFunctions}
  ${triplanarDetailUniforms}
  ${triplanarDetailFunctions}
  ${asteroidAppearanceFunctions}
  ${basisFunctions}

  bool impostorFinite(float value) { return !isnan(value) && !isinf(value); }
  bool impostorInside(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }

  vec2 impostorUv(vec2 uv, float frame, float mip) {
    float tile = uImpostorLayout.y * exp2(-mip);
    vec2 offset = vec2(mod(frame, uImpostorLayout.x), floor(frame / uImpostorLayout.x)) * tile;
    return (offset + clamp(uv * tile, vec2(0.5), vec2(tile - 0.5))) / (uImpostorLayout.x * tile);
  }

  void impostorRead(vec2 uv, float frame, float lod, out vec4 normalDepth, out vec4 surfaceCoverage) {
    float lo = floor(lod), hi = min(lo + 1.0, uImpostorLayout.z), blend = lod - lo;
    vec3 a = vec3(impostorUv(uv, frame, lo), vAtlasParams.x);
    normalDepth = textureLod(uImpostorNormalDepth, a, lo);
    surfaceCoverage = textureLod(uImpostorSurfaceCoverage, a, lo);
    if (blend > 0.0) {
      vec3 b = vec3(impostorUv(uv, frame, hi), vAtlasParams.x);
      normalDepth = mix(normalDepth, textureLod(uImpostorNormalDepth, b, hi), blend);
      surfaceCoverage = mix(surfaceCoverage, textureLod(uImpostorSurfaceCoverage, b, hi), blend);
    }
  }

  vec4 renderImpostor(vec3 rayDx, vec3 rayDy) {
    bool perspective = isPerspectiveMatrix(projectionMatrix);
    vec3 center = vRingPos;
    vec3 origin = -vAtlasViewToObject * center;
    vec3 direction = vAtlasRayPoint;
    vec3 originDx = vec3(0.0), originDy = vec3(0.0);
    if (!perspective) {
      origin += vAtlasRayPoint;
      direction = vAtlasViewToObject * vec3(0.0, 0.0, -1.0);
      originDx = rayDx; originDy = rayDy;
      rayDx = rayDy = vec3(0.0);
    }
    float coverage = 0.0, tSum = 0.0;
    vec3 normalSum = vec3(0.0);
    vec2 surfaceSum = vec2(0.0);
    for (int i = 0; i < 3; i++) {
      float frameWeight = vAtlasWeights[i];
      if (frameWeight <= 0.0) continue;
      float frame = vAtlasFrames[i];
      mat3 basis = impostorFrameBasis(frame, uImpostorLayout.x);
      float denominator = dot(direction, basis[2]);
      if (abs(denominator) < 1e-5 * length(direction)) continue;
      float t = -dot(origin, basis[2]) / denominator;
      vec3 p = origin + direction * t;
      float h = vAtlasParams.y;
      vec2 uv = vec2(dot(p, basis[0]), dot(p, basis[1])) / (2.0 * h) + 0.5;
      vec3 dx = originDx + t * rayDx - direction * ((dot(originDx, basis[2]) + t * dot(rayDx, basis[2])) / denominator);
      vec3 dy = originDy + t * rayDy - direction * ((dot(originDy, basis[2]) + t * dot(rayDy, basis[2])) / denominator);
      vec2 uvDx = vec2(dot(dx, basis[0]), dot(dx, basis[1])) / (2.0 * h);
      vec2 uvDy = vec2(dot(dy, basis[0]), dot(dy, basis[1])) / (2.0 * h);
      float footprint = max(length(uvDx), length(uvDy)) * uImpostorLayout.y;
      float lod = clamp(log2(max(footprint, 1e-8)), 0.0, uImpostorLayout.z);
      if (!impostorInside(uv) || t <= 0.0 || !impostorFinite(t)) continue;
      vec4 n, s;
      impostorRead(uv, frame, lod, n, s);
      if (s.a < 1e-5) continue;
      t = (h * (2.0 * n.a / s.a - 1.0) - dot(origin, basis[2])) / denominator;
      p = origin + direction * t;
      uv = vec2(dot(p, basis[0]), dot(p, basis[1])) / (2.0 * h) + 0.5;
      if (!impostorInside(uv) || t <= 0.0 || !impostorFinite(t)) continue;
      impostorRead(uv, frame, lod, n, s);
      if (s.a < 1e-5) continue;
      t = (h * (2.0 * n.a / s.a - 1.0) - dot(origin, basis[2])) / denominator;
      if (t <= 0.0 || !impostorFinite(t)) continue;
      vec3 decodedNormal = n.rgb / s.a * 2.0 - 1.0;
      if (dot(decodedNormal, decodedNormal) < 1e-8) continue;
      float w = frameWeight * s.a;
      coverage += w;
      normalSum += w * normalize(decodedNormal);
      tSum += w * t;
      surfaceSum += w * s.xy / s.a;
    }
    bool valid = coverage > 1e-5 && dot(normalSum, normalSum) > 1e-10;
    // Соседние helper-фрагменты тоже должны иметь конечную нормаль для specular AA.
    vec3 objectPosition = valid ? origin + direction * (tSum / max(coverage, 1e-5)) : vec3(0.0, 0.0, vAtlasParams.y * 0.25);
    vec3 objectNormal = valid ? normalize(normalSum) : vec3(0.0, 0.0, 1.0);
    vec3 viewPosition = center + inverse(vAtlasViewToObject) * objectPosition;
    float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vFade < 0.0) threshold = 1.0 - threshold;
    float alpha = coverage * uFade * vDistanceFade;
    vec3 ringPosition = (inverse(modelViewMatrix) * vec4(viewPosition, 1.0)).xyz + uOriginOffset;
    AsteroidAppearanceProfile profile = AsteroidAppearanceProfile(uRockColor, uSpecularStrength, uSpecularPower, uSpecularTint, uLunarMix, uSurfaceAmbient);
    #ifdef USE_ICE_VARIETY
      profile = AsteroidAppearanceProfile(mix(uRockColor, uIceRockColor, vIce), mix(uSpecularStrength, uIceSpecularStrength, vIce),
        mix(uSpecularPower, uIceSpecularPower, vIce), mix(uSpecularTint, uIceSpecularTint, vIce), mix(uLunarMix, uIceLunarMix, vIce), mix(uSurfaceAmbient, uIceSurfaceAmbient, vIce));
    #endif
    vec3 color = shadeAsteroid(objectPosition * uImpostorPhysicalSize, objectNormal, transpose(vAtlasViewToObject), -viewPosition,
      vLightDirView - viewPosition, vPlanetDirView - viewPosition, vRingNormalView, ringPosition, surfaceSum / max(coverage, 1e-5),
      vInstanceSeed, vEllipse.xyz, vec2(0.0), 0.0, profile);
    if (!valid || !impostorFinite(viewPosition.z) || viewPosition.z >= 0.0 || alpha < 0.01 || abs(vFade) < threshold) discard;
    vec4 clip = projectionMatrix * vec4(viewPosition, 1.0);
    #if defined(USE_LOGARITHMIC_DEPTH_BUFFER)
      if (perspective) gl_FragDepth = log2(1.0 - viewPosition.z) * logDepthBufFC * 0.5;
      else gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
    #else
      gl_FragDepth = (clip.z / clip.w) * 0.5 + 0.5;
    #endif
    return vec4(color, alpha);
  }
`

export function atlasImpostorShaders(vertex: string, fragment: string, ice: boolean): { vertexShader: string; fragmentShader: string } {
  if (ice) vertex = vertex.replace(asteroidIceBillboardVertexDecl, asteroidIceVertexDecl)
  vertex = vertex.replace('void main() {', `${vertexFunctions}\nvoid main() {\n${ice ? asteroidIceVertexSelect : ''}\n${vertexMain}`)
  fragment = fragment.replace('void main() {', `${fragmentFunctions}\nvoid main() {
    vec3 atlasRayDx = dFdx(vAtlasRayPoint), atlasRayDy = dFdy(vAtlasRayPoint);
    if (vAtlasParams.z > 0.5) { gl_FragColor = renderImpostor(atlasRayDx, atlasRayDy); return; }`)
  return { vertexShader: vertex, fragmentShader: fragment }
}
